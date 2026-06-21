"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceDot,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { MetricWithData } from "@/app/actions/metrics";
import { summarizeTrend, describeMetric } from "@/lib/trend-insight";
import { ChartTooltip } from "./chart-tooltip";

interface Props {
  metrics: MetricWithData[];
  title?: string;
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#f97316"];

const UNIT_SUFFIX: Record<string, string> = {
  count: "events",
  unique_users: "users",
  unique_sessions: "sessions",
};

// Merge all metric trends into one data array keyed by date
function mergeData(metrics: MetricWithData[]) {
  const map: Record<string, Record<string, number>> = {};

  for (const m of metrics) {
    for (const point of m.trend) {
      if (!map[point.date]) map[point.date] = {};
      map[point.date][m.name] = point.value;
    }
  }

  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date: date.slice(5), ...vals })); // "MM-DD"
}

export function MetricsChart({ metrics, title = "30-day trend" }: Props) {
  if (metrics.length === 0) return null;

  const data = mergeData(metrics);

  return (
    <div className="rounded-xl border bg-card p-5">
      <h3 className="font-semibold mb-1">{title}</h3>

      {/* Plain-English line per series — no chart-reading required. Built
          only from the real total/target/trend numbers already computed for
          each metric, same as the KPI cards. */}
      <div className="space-y-1 mb-3">
        {metrics.map((m, i) => {
          const insight = summarizeTrend(m.trend);
          const unit = UNIT_SUFFIX[m.aggregation] ?? "";
          const cleanName = m.name.replace(/^\[.+?\]\s*/, "");
          const sentence = describeMetric({ name: cleanName, total: m.total, unit, targetValue: m.target_value, insight });
          return (
            <p key={m.id} className="flex items-start gap-1.5 text-[12px] text-muted-foreground leading-snug">
              <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 mt-1" style={{ background: COLORS[i % COLORS.length] }} />
              {insight.direction === "up" && <TrendingUp className="h-3 w-3 text-emerald-500 flex-shrink-0 mt-0.5" />}
              {insight.direction === "down" && <TrendingDown className="h-3 w-3 text-red-500 flex-shrink-0 mt-0.5" />}
              {(insight.direction === "flat" || insight.direction === "no_data") && <Minus className="h-3 w-3 text-gray-400 flex-shrink-0 mt-0.5" />}
              <span><strong className="text-foreground">{cleanName}:</strong> {sentence}</span>
            </p>
          );
        })}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {metrics.map((m, i) => (
                <linearGradient key={m.id} id={`cg-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              cursor={{ stroke: "#6366f1", strokeOpacity: 0.15, strokeWidth: 20 }}
              content={<ChartTooltip />}
            />
            {metrics.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {metrics.map((m, i) => {
              const unit = UNIT_SUFFIX[m.aggregation] ?? "";
              return (
                <Area
                  key={m.id}
                  type="monotone"
                  dataKey={m.name}
                  name={`${m.name.replace(/^\[.+?\]\s*/, "")}${unit ? ` (${unit})` : ""}`}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  fill={`url(#cg-${i})`}
                  dot={false}
                  activeDot={{ r: 4, stroke: COLORS[i % COLORS.length], strokeWidth: 2, fill: "#fff" }}
                  isAnimationActive={false}
                />
              );
            })}
            {/* Peak markers — one dot per series, placed as siblings of the
                Areas (ReferenceDot isn't a valid child of Area in Recharts). */}
            {metrics.map((m, i) => {
              const insight = summarizeTrend(m.trend);
              const peakRaw = insight.hasActivity && m.trend.length
                ? m.trend.reduce((max, p) => (p.value > max.value ? p : max), m.trend[0])
                : null;
              if (!peakRaw) return null;
              return (
                <ReferenceDot
                  key={`peak-${m.id}`}
                  x={peakRaw.date.slice(5)}
                  y={peakRaw.value}
                  r={3}
                  fill={COLORS[i % COLORS.length]}
                  stroke="#fff"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
