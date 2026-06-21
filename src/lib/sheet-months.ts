// Shared, server-safe month-column helpers for reading a value out of a
// connected spreadsheet (Reports/Sources) for "the current month".
//
// This is a deliberately separate copy of the same wide-month detection
// logic the Reports page already uses client-side (see detectWideMonthColumns
// in src/app/(dashboard)/reports/page.tsx) — duplicated rather than imported,
// since that file is a big, already-working client component and importing
// from it into a server action risks pulling in client-only code. No "use
// server" here; this is a plain helper module, importable from anywhere.

export const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_NAMES_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseMonthEntry(val: string): { sortKey: number; display: string } | null {
  if (!val) return null;
  const v = val.trim();

  const nameYear = v.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (nameYear) {
    const mFull = MONTH_NAMES_FULL.findIndex((m) => m.toLowerCase() === nameYear[1].toLowerCase());
    const mAbbr = MONTH_NAMES_ABBR.findIndex((m) => m.toLowerCase() === nameYear[1].toLowerCase().slice(0, 3));
    const idx = mFull >= 0 ? mFull : mAbbr;
    if (idx >= 0) return { sortKey: parseInt(nameYear[2]) * 12 + idx, display: v };
  }

  const ymMatch = v.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const idx = parseInt(ymMatch[2]) - 1;
    if (idx >= 0 && idx <= 11)
      return { sortKey: parseInt(ymMatch[1]) * 12 + idx, display: `${MONTH_NAMES_FULL[idx]} ${ymMatch[1]}` };
  }

  const fullIdx = MONTH_NAMES_FULL.findIndex((m) => m.toLowerCase() === v.toLowerCase());
  if (fullIdx >= 0) return { sortKey: fullIdx, display: v };

  if (v.length <= 4) {
    const abbrIdx = MONTH_NAMES_ABBR.findIndex((m) => m.toLowerCase() === v.toLowerCase().slice(0, 3));
    if (abbrIdx >= 0) return { sortKey: abbrIdx, display: MONTH_NAMES_FULL[abbrIdx] };
  }

  return null;
}

// Headers like "May - Value", "June vs Target" → Map<"May", ["May - Value", ...]>
export function detectWideMonthColumns(headers: string[]): Map<string, string[]> | null {
  const monthMap = new Map<string, { sortKey: number; cols: string[] }>();
  headers.forEach((h) => {
    const firstWord = h.trim().split(/[\s\-_/]+/)[0];
    const entry = parseMonthEntry(firstWord);
    if (entry) {
      const key = entry.display;
      if (!monthMap.has(key)) monthMap.set(key, { sortKey: entry.sortKey, cols: [] });
      monthMap.get(key)!.cols.push(h);
    }
  });
  if (monthMap.size < 2) return null;
  const sorted = new Map([...monthMap.entries()].sort((a, b) => a[1].sortKey - b[1].sortKey));
  const result = new Map<string, string[]>();
  sorted.forEach((v, k) => result.set(k, v.cols));
  return result;
}

// Within one month's column group (e.g. ["May - Value", "May - Target", "May
// - vs Target"]), pick the one that actually holds the raw value rather than
// a target/delta column — picking the wrong one would silently feed the
// wrong number into a KPI, which is worse than refusing to guess.
export function pickValueColumn(monthCols: string[]): string | null {
  const valueCol = monthCols.find((c) => /value/i.test(c));
  if (valueCol) return valueCol;
  // Only one column for this month and it's not obviously a target/delta —
  // safe enough to treat it as the value.
  if (monthCols.length === 1 && !/target|vs\b|delta|change/i.test(monthCols[0])) return monthCols[0];
  return null;
}

// Strip "£", "$", ",", "%" etc. and parse — same leniency the Reports page
// column-stats strip already assumes real spreadsheet exports need.
export function parseNumericCell(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
