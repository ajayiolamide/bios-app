"use server";

// Reads a KPI's actual value out of a connected spreadsheet row instead of a
// tracked event — for operational KPIs (e.g. "claims paid within 24hrs")
// that get their real number from manually asking a team, not from Mixpanel.
// See migration 029 + src/lib/sheet-months.ts for the matching logic this
// builds on.

import { fetchSheetData } from "./reports";
import { detectWideMonthColumns, pickValueColumn, parseNumericCell, parseMonthEntry } from "@/lib/sheet-months";
import type { Metric } from "@/types/database";

export type ManualKpiValue = {
  value: number | null;
  monthLabel: string | null;
  error?: string;
};

// Given a KPI that's configured with source_report_id/source_label_column/
// source_row_value, find this month's number in that sheet.
export async function getManualKpiValue(metric: Metric): Promise<ManualKpiValue> {
  if (!metric.source_report_id || !metric.source_label_column || !metric.source_row_value) {
    return { value: null, monthLabel: null, error: "Not linked to a sheet row." };
  }

  const { rows, headers, error } = await fetchSheetData(metric.source_report_id);
  if (error) return { value: null, monthLabel: null, error };

  const row = rows.find((r) => (r[metric.source_label_column!] ?? "").trim() === metric.source_row_value!.trim());
  if (!row) return { value: null, monthLabel: null, error: `Row "${metric.source_row_value}" not found in the sheet anymore.` };

  const monthMap = detectWideMonthColumns(headers);
  if (!monthMap) return { value: null, monthLabel: null, error: "Couldn't find month columns (e.g. \"May - Value\") in this sheet." };

  // Pick the most recent month in the sheet that's <= today — a sheet
  // updated through May, opened in June, should keep showing May's real
  // number rather than a blank/zero "current month".
  const now = new Date();
  const currentSortKey = now.getFullYear() * 12 + now.getMonth();
  let bestKey = -Infinity;
  let bestMonth: string | null = null;
  for (const monthLabel of monthMap.keys()) {
    const entry = parseMonthEntry(monthLabel);
    if (!entry) continue;
    if (entry.sortKey <= currentSortKey && entry.sortKey > bestKey) {
      bestKey = entry.sortKey;
      bestMonth = monthLabel;
    }
  }
  if (!bestMonth) return { value: null, monthLabel: null, error: "No month in this sheet is at or before the current month yet." };

  const valueCol = pickValueColumn(monthMap.get(bestMonth)!);
  if (!valueCol) return { value: null, monthLabel: bestMonth, error: `Couldn't tell which "${bestMonth}" column holds the value (vs. target/delta).` };

  const value = parseNumericCell(row[valueCol]);
  if (value === null) return { value: null, monthLabel: bestMonth, error: `"${row[valueCol]}" in ${valueCol} isn't a number.` };

  return { value, monthLabel: bestMonth };
}

// For the KpiForm row-picker: distinct values in a given column, so the user
// can pick "which row is this KPI" from what's actually in the sheet instead
// of typing it blind.
export async function getSheetRowOptions(
  sourceId: string,
  labelColumn: string
): Promise<{ options: string[]; error?: string }> {
  const { rows, error } = await fetchSheetData(sourceId);
  if (error) return { options: [], error };
  const seen = new Set<string>();
  for (const r of rows) {
    const v = (r[labelColumn] ?? "").trim();
    if (v) seen.add(v);
  }
  return { options: [...seen] };
}
