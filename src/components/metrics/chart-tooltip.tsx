"use client";

// Recharts' default tooltip is a tiny, barely-styled box that shows raw
// values (e.g. "unique_users: 4") with no date formatting. Replacing it with
// a custom, readable card — proper date, real unit, color dot per series —
// is most of what makes hovering a chart actually feel useful instead of
// just decorative.

type Entry = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
  // The full merged data row for this point (recharts passes this through
  // automatically) — used to pull `${dataKey}__total`/`${dataKey}__matched`
  // for per-occurrence rate series, which the plain `value` field can't carry.
  payload?: Record<string, number | string>;
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: Entry[];
  label?: string | number;
  unit?: string;
  formatLabel?: (label: string) => string;
}

export function ChartTooltip({ active, payload, label, unit, formatLabel }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const displayLabel = typeof label === "string" && formatLabel ? formatLabel(label) : label;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-lg px-3 py-2 min-w-[140px]">
      <p className="text-[11px] font-semibold text-gray-700 mb-1">{displayLabel}</p>
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const total = p.dataKey ? p.payload?.[`${p.dataKey}__total`] : undefined;
          const matched = p.dataKey ? p.payload?.[`${p.dataKey}__matched`] : undefined;
          const hasCounts = typeof total === "number";

          // No claims that day at all vs claims came in but none matched —
          // both plot as a flat 0 on the line, but they mean very different
          // things, so say so explicitly instead of just showing "0%".
          if (hasCounts && total === 0) {
            return (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-400 italic">
                {p.color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />}
                No occurrences this day
              </div>
            );
          }

          return (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-600">
              {p.color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />}
              {p.name && <span className="truncate">{p.name}:</span>}
              <strong className="text-gray-900 tabular-nums">
                {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
              </strong>
              {unit && <span className="text-gray-400">{unit}</span>}
              {hasCounts && (
                <span className="text-gray-400">
                  ({matched ?? 0} of {total})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function formatIsoDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
