"use client";

import {
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
  Tooltip,
} from "recharts";
import type { FunnelStepResult } from "@/app/actions/funnels";

interface Props {
  results: FunnelStepResult[];
}

const COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe", "#e0e7ff", "#eef2ff"];

export function FunnelConversionChart({ results }: Props) {
  const hasMixpanelData = results.some(r => r.data_source === "mixpanel");
  const hasNoData = results.length === 0 || results.every(r => r.users === 0);

  if (hasNoData) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No data yet — import events or connect Mixpanel to see conversion rates.
      </div>
    );
  }

  const data = results.map((r, i) => ({
    name: r.event_name,
    value: r.users,
    fill: COLORS[i % COLORS.length],
    conversion: r.conversion_from_first,
  }));

  return (
    <div className="space-y-4">
      {/* Recharts funnel */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip
              formatter={(v: number, _: string, props: { payload?: { conversion?: number } }) => [
                `${v.toLocaleString()} users (${props.payload?.conversion ?? 0}% of first step)`,
                "Users",
              ]}
            />
            <Funnel dataKey="value" data={data} isAnimationActive={false}>
              <LabelList
                position="center"
                content={({ x, y, width, height, value, index }) => {
                  const item = data[Number(index)];
                  return (
                    <text
                      x={Number(x) + Number(width) / 2}
                      y={Number(y) + Number(height) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={12}
                      fill="#fff"
                      fontWeight={600}
                    >
                      {item.name} · {(value as number).toLocaleString()}
                    </text>
                  );
                }}
              />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>

      {/* Step breakdown table */}
      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center shrink-0"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            >
              {r.step}
            </span>
            <span className="flex-1 text-sm truncate">{r.event_name}</span>
            {r.data_source === "mixpanel" && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100">
                Mixpanel
              </span>
            )}
            {/* A 0 here from "none" means we found zero tracked occurrences of
                this exact event name — that's a data gap (wrong name, not
                synced yet, or genuinely never fires), not evidence that 0%
                of users converted. Those two look identical as a bare number,
                so call it out explicitly instead of letting it read as a
                real, severe drop-off. */}
            {r.data_source === "none" && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100" title="No tracked occurrences of this exact event name in the last 30 days — check the spelling, or it may not have data yet">
                No data
              </span>
            )}
            <span className="text-sm font-semibold tabular-nums" title={r.data_source === "none" ? "No tracked occurrences found — not the same as a real 0%" : undefined}>
              {r.users.toLocaleString()}
            </span>
            {i > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                {r.conversion_from_prev}% prev
              </span>
            )}
          </div>
        ))}
      </div>

      {hasMixpanelData && (
        <p className="text-[11px] text-purple-500 text-center pt-1">
          📊 Mixpanel steps show aggregate event counts (last 30 days), not sequential user journeys
        </p>
      )}
      {results.some(r => r.data_source === "none") && (
        <p className="text-[11px] text-amber-600 text-center pt-1">
          ⚠ Some steps have no tracked occurrences at all — double-check the event name, or give it time to sync
        </p>
      )}
    </div>
  );
}
