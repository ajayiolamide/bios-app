"use client";

import { useState } from "react";
import { Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { Funnel, FunnelStepResult } from "@/app/actions/funnels";
import { computeFunnel, deleteFunnel } from "@/app/actions/funnels";
import { FunnelConversionChart } from "./funnel-chart";

interface Props {
  funnel: Funnel;
  orgId: string;
  onDeleted: () => void;
}

export function FunnelCard({ funnel, orgId, onDeleted }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<FunnelStepResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!expanded && results === null) {
      setLoading(true);
      const r = await computeFunnel(orgId, funnel.steps as { event_name: string }[]);
      setResults(r);
      setLoading(false);
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
        <div className="border-t px-5 py-4">
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              Computing…
            </div>
          ) : results ? (
            <FunnelConversionChart results={results} />
          ) : null}
        </div>
      )}
    </div>
  );
}
