// Turns a 30-day trend array into a short, honest, plain-language read —
// computed purely from data already fetched (no new queries, no invented
// numbers). Two real signals: which day was the peak, and whether the
// second half of the window ran higher than the first half. That second one
// is a real, derivable trend direction — not a guess — since it's just
// comparing two halves of data already on hand.

export type TrendPoint = { date: string; value: number };

export type TrendInsight = {
  hasActivity: boolean;
  peak: { date: string; value: number } | null;
  avgPerDay: number;
  // Percent change of second-half average vs first-half average. Null when
  // there isn't enough non-zero data on both sides to say anything real.
  changePct: number | null;
  direction: "up" | "down" | "flat" | "no_data";
};

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function summarizeTrend(trend: TrendPoint[]): TrendInsight {
  if (!trend.length) {
    return { hasActivity: false, peak: null, avgPerDay: 0, changePct: null, direction: "no_data" };
  }

  const total = trend.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) {
    return { hasActivity: false, peak: null, avgPerDay: 0, changePct: null, direction: "no_data" };
  }

  const peakPoint = trend.reduce((max, p) => (p.value > max.value ? p : max), trend[0]);
  const avgPerDay = total / trend.length;

  const mid = Math.floor(trend.length / 2);
  const firstHalf = trend.slice(0, mid);
  const secondHalf = trend.slice(mid);
  const firstAvg = firstHalf.reduce((s, p) => s + p.value, 0) / (firstHalf.length || 1);
  const secondAvg = secondHalf.reduce((s, p) => s + p.value, 0) / (secondHalf.length || 1);

  let changePct: number | null = null;
  let direction: TrendInsight["direction"] = "flat";

  if (firstAvg === 0 && secondAvg === 0) {
    direction = "flat";
  } else if (firstAvg === 0) {
    // Went from nothing to something — real signal, but a % change is undefined (divide by zero).
    direction = "up";
  } else {
    changePct = Math.round(((secondAvg - firstAvg) / firstAvg) * 100);
    if (changePct > 10) direction = "up";
    else if (changePct < -10) direction = "down";
    else direction = "flat";
  }

  return {
    hasActivity: true,
    peak: { date: formatShortDate(peakPoint.date), value: peakPoint.value },
    avgPerDay,
    changePct,
    direction,
  };
}

// One plain-English sentence, no chart-reading required. Built only from
// real numbers already on the page (total, unit, target_value, and the
// insight above) — never a hallucinated claim. Designed so someone with zero
// context on this product can read it and know what's going on.
export function describeMetric(args: {
  name: string;
  total: number;
  unit: string;
  targetValue: number | null;
  insight: TrendInsight;
}): string {
  const { name, total, unit, targetValue, insight } = args;

  if (!insight.hasActivity) {
    return `No ${name.toLowerCase()} activity recorded in the last 30 days.`;
  }

  const totalPart = `${total.toLocaleString()} ${unit} in the last 30 days`;

  let targetPart = "";
  if (targetValue && targetValue > 0) {
    const pct = Math.round((total / targetValue) * 100);
    targetPart = pct >= 100
      ? ` — ${pct >= 200 ? `${Math.round(pct / 100)}x past` : `${pct}% of`} the ${targetValue.toLocaleString()} target`
      : ` — ${pct}% of the way to the ${targetValue.toLocaleString()} target`;
  }

  let trendPart = "";
  if (insight.direction === "up") {
    trendPart = insight.changePct !== null ? `, trending up ${insight.changePct}% this period` : ", and just started showing activity";
  } else if (insight.direction === "down") {
    trendPart = `, trending down ${Math.abs(insight.changePct ?? 0)}% this period`;
  } else {
    trendPart = ", holding steady";
  }

  return `${totalPart}${targetPart}${trendPart}.`;
}
