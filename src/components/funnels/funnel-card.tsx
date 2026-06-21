"use client";

import { useState } from "react";
import { Trash2, ChevronDown, ChevronUp, Sparkles, RefreshCw, Loader2 } from "lucide-react";
import type { Funnel, FunnelStepResult } from "@/app/actions/funnels";
import { computeFunnel, deleteFunnel, getFunnelInsight } from "@/app/actions/funnels";
import { FunnelConversionChart } from "./funnel-chart";
import { SaveInsightButton } from "@/components/saved-insights/save-insight-button";

interface Props {
  funnel: Funnel;
  orgId: string;
  onDeleted: () => void;
}

export function FunnelCard({ funnel, orgId, onDeleted }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<FunnelStepResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);

  async function generateInsight(r: FunnelStepResult[]) {
    setInsightLoading(true);
    const text = await getFunnelInsight(funnel.name, r);
    setInsight(text);
    setInsightLoading(false);
  }

  async function toggle() {
    if (!expanded && results === null) {
      setLoading(true);
      const r = await computeFunnel(orgId, funnel.steps as { event_name: string }[]);
      setResults(r);
      setLoading(false);
      if (r.some(s => s.users > 0)) generateInsight(r);
    }
    setExpanded((v) => !v);
  }

  async function handleDelete() {
    if (!confirm(`Delete funnel "${funnel.name}"?`)) return;
    const { error } = await deleteFunnel(funnel.id);
    if (error) alert("Failed to delete: " + error);
    else onDeleted();
  }

  const overallConversion =
    results && results.length > 1 && results[0].users > 0
      ? Math.round((results[results.length - 1].users / results[0].users) * 100)
      : null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-5 py-4">
        <button onClick={toggle} className="flex-1 flex items-start gap-3 text-left min-w-0">
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{funnel.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(funnel.steps as { event_name: string }[]).map((s) => s.event_name).join(" → ")}
            </p>
            {funnel.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{funnel.description}</p>
            )}
          </div>
          {overallConversion !== null && (
            <span className="shrink-0 text-lg font-bold tabular-nums text-primary">
              {overallConversion}%
            </span>
          )}
        </button>

        <button
          onClick={toggle}
          className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          onClick={handleDelete}
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded chart */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4">
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              Computing…
            </div>
          ) : results ? (
            <>
              <FunnelConversionChart results={results} />
              {results.some(s => s.users > 0) && (
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-indigo-500" />
                      <span className="text-sm font-semibold text-gray-800">AI Insight</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!insightLoading && insight && (
                        <SaveInsightButton
                          orgId={orgId}
                          source="funnel"
                          content={insight.replace(/\*\*/g, "")}
                          context={`Funnel — ${funnel.name}`}
                        />
                      )}
                      <button
                        onClick={() => generateInsight(results)}
                        disabled={insightLoading}
                        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                      >
                        {insightLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                        {insightLoading ? "Analyzing…" : "Refresh"}
                      </button>
                    </div>
                  </div>
                  {insightLoading ? (
                    <div className="space-y-2">
                      {[...Array(2)].map((_, i) => <div key={i} className="h-3.5 bg-gray-100 animate-pulse rounded" style={{ width: `${80 - i * 15}%` }} />)}
                    </div>
                  ) : insight ? (
                    <div className="space-y-2">
                      {insight.split("\n").map(l => l.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean).map((line, i) => (
                        <p key={i} className="text-sm text-gray-700 leading-relaxed flex gap-2">
                          <span className="text-indigo-400 flex-shrink-0">•</span>
                          <span>{line.replace(/\*\*/g, "")}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No insight yet.</p>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
