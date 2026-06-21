"use client";

import { Trash2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricWithData } from "@/app/actions/metrics";
import { deleteMetric } from "@/app/actions/metrics";
import { summarizeTrend, describeMetric } from "@/lib/trend-insight";
import { ChartTooltip, formatIsoDateLabel } from "./chart-tooltip";

interface MetricCardProps {
  metric: MetricWithData;
  onDeleted: () => void;
}

const AGGS: Record<string, string> = {
  count: "Raw event count",
  unique_users: "Unique users",
  unique_sessions: "Unique sessions",
};

// What's actually plotted is always a count of one kind or another — this app
// has no concept of a denominator yet, so it can never produce a real
// percentage. Suffixing the number with its real unit keeps that honest even
// when the saved description (often AI-written) talks about a "rate" or "%".
const UNIT_SUFFIX: Record<string, string> = {
  count: "events",
  unique_users: "users",
  unique_sessions: "sessions",
};

const KIND_LABEL: Record<string, string> = {
  metric: "Metric",
  kpi: "KPI",
  guardrail: "Guardrail",
};

export function MetricCard({ metric, onDeleted }: MetricCardProps) {
  async function handleDelete() {
    if (!confirm(`Delete metric "${metric.name}"?`)) return;
    const { error } = await deleteMetric(metric.id);
    if (error) alert("Failed to delete: " + error);
    else onDeleted();
  }

  // Strip the "[Feature Name] " prefix here since the page already groups by
  // it and shows it as a section header — repeating it on every card is noise.
  const displayName = metric.name.replace(/^\[.+?\]\s*/, "");
  const unit = UNIT_SUFFIX[metric.aggregation] ?? "";
  const insight = summarizeTrend(metric.trend);
  const headline = describeMetric({ name: displayName, total: metric.total, unit, targetValue: metric.target_value, insight });
  // Raw (un-formatted) peak point, for placing the marker on the actual chart —
  // insight.peak.date is already human-formatted ("Jun 4"), not usable as the x value.
  const peakRaw = insight.hasActivity && metric.trend.length
    ? metric.trend.reduce((max, p) => (p.value > max.value ? p : max), metric.trend[0])
    : null;

  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold tracking-wider uppercase text-muted-foreground/70">
              {KIND_LABEL[metric.kind] ?? "Metric"}
            </span>
            <p className="font-semibold truncate">{displayName}</p>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {metric.event_name ? (
              <>
                <code className="text-indigo-500">{metric.event_name}</code> · {AGGS[metric.aggregation] ?? metric.aggregation}
              </>
            ) : (
              <span className="text-amber-500 font-medium">Not wired to an event yet</span>
            )}
          </p>
        </div>
        <button
          onClick={handleDelete}
          className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          title="Delete metric"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {!metric.event_name ? (
        <p className="text-xs text-muted-foreground italic">
          Define an event for this KPI to start measuring it.
        </p>
      ) : (
        <>
          {/* Headline — one plain sentence, no chart-reading required. This
              is the thing meant to answer "what does this mean" on its own. */}
          <p className="text-sm font-medium text-foreground leading-snug flex items-start gap-1.5">
            {insight.direction === "up" && <TrendingUp className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />}
            {insight.direction === "down" && <TrendingDown className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />}
            {(insight.direction === "flat" || insight.direction === "no_data") && <Minus className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />}
            <span>{headline}</span>
          </p>

          {/* Chart — hover any point for the exact day and count. The peak
              day is marked on the line itself, not just hidden in a tooltip. */}
          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metric.trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`grad-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Hidden axes — no visible ticks/lines, but needed so
                    ReferenceDot has a real scale to position against. */}
                <XAxis dataKey="date" hide />
                <YAxis hide domain={[0, "auto"]} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  fill={`url(#grad-${metric.id})`}
                  dot={false}
                  activeDot={{ r: 4, stroke: "#6366f1", strokeWidth: 2, fill: "#fff" }}
                  isAnimationActive={false}
                />
                {peakRaw && (
                  <ReferenceDot x={peakRaw.date} y={peakRaw.value} r={3} fill="#6366f1" stroke="#fff" strokeWidth={1.5} />
                )}
                <Tooltip
                  cursor={{ stroke: "#6366f1", strokeOpacity: 0.2, strokeWidth: 16 }}
                  content={<ChartTooltip unit={unit} formatLabel={formatIsoDateLabel} />}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Numbers — supporting detail for anyone who wants the raw figures
              behind the sentence above. */}
          <div className="grid grid-cols-2 gap-3 text-center border-t pt-2 -mt-0.5">
            <div>
              <p className="text-base font-bold tabular-nums leading-none">{metric.total.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{unit} · 30d</p>
            </div>
            <div>
              <p className="text-base font-bold tabular-nums leading-none text-muted-foreground">
                {metric.target_value != null ? metric.target_value.toLocaleString() : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={metric.target ?? undefined}>
                target{metric.target ? ` · ${metric.target}` : ""}
              </p>
            </div>
          </div>

          {metric.description && (
            <p className="text-[11px] text-muted-foreground/70 italic truncate -mt-1" title={metric.description}>
              Tracking intent: {metric.description}
            </p>
          )}
        </>
      )}
    </div>
  );
}
