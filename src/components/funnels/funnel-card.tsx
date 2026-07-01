"use client";

import { useState, useEffect } from "react";
import { Trash2, ChevronDown, ChevronUp, Sparkles, RefreshCw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Funnel, FunnelStepResult } from "@/app/actions/funnels";
import { computeFunnel, deleteFunnel, getFunnelInsight, updateFunnelLookback } from "@/app/actions/funnels";
import { getMixpanelSettings, syncMixpanelRawEvents } from "@/app/actions/mixpanel";
import { FunnelConversionChart } from "./funnel-chart";
import { SaveInsightButton } from "@/components/saved-insights/save-insight-button";

type SyncState = "idle" | "syncing" | "done" | "error";

interface Props {
  funnel: Funnel;
  orgId: string;
  onDeleted: () => void;
}

const LOOKBACK_OPTIONS = [30, 60, 90];

export function FunnelCard({ funnel, orgId, onDeleted }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<FunnelStepResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  // Without a try/catch here, a thrown error skipped straight past
  // setLoading(false) and setExpanded — the chevron looked "frozen" because
  // the click handler died silently partway through, never reaching the
  // lines that would un-stick the UI. computeFunnel itself is just a local
  // DB query now (see funnels.ts), but this guard stays cheap insurance.
  const [computeError, setComputeError] = useState<string | null>(null);
  // How far back to sequence users through the steps. Used to be a fixed
  // 30 days everywhere, which under-counts longer conversion cycles (e.g.
  // signup week 1, first purchase week 6 reads as a drop-off). Persisted
  // per-funnel so the choice sticks next time it's opened.
  const [lookbackDays, setLookbackDays] = useState(funnel.lookback_days ?? 30);
  // Pulling fresh per-occurrence data from Mixpanel used to happen
  // automatically inside computeFunnel on every expand — moved to this
  // explicit action instead (see comment in funnels.ts) so opening a funnel
  // is a fast local query by default, and hitting Mixpanel's raw export API
  // is something you choose to do, not something that blocks every click.
  const [mpConnected, setMpConnected] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    getMixpanelSettings(orgId).then(({ connected }) => setMpConnected(connected));
  }, [orgId]);

  async function handleSyncMixpanel() {
    if (syncState === "syncing") return;
    setSyncState("syncing");
    setSyncMsg(null);
    const eventNames = (funnel.steps as { event_name: string }[]).map(s => s.event_name);
    const result = await syncMixpanelRawEvents(orgId, eventNames, lookbackDays);
    if (result.error) {
      setSyncState("error");
      setSyncMsg(result.error);
    } else {
      setSyncState("done");
      setSyncMsg(result.synced > 0 ? `Pulled ${result.synced.toLocaleString()} new event${result.synced !== 1 ? "s" : ""} from Mixpanel` : "Already up to date");
      await loadResults(lookbackDays);
    }
  }

  async function generateInsight(r: FunnelStepResult[]) {
    setInsightLoading(true);
    const text = await getFunnelInsight(funnel.name, r);
    setInsight(text);
    setInsightLoading(false);
  }

  async function loadResults(days: number) {
    setLoading(true);
    setComputeError(null);
    try {
      const r = await computeFunnel(orgId, funnel.steps as { event_name: string }[], days);
      setResults(r);
      setInsight("");
      if (r.some(s => s.users > 0)) generateInsight(r);
    } catch (err) {
      setComputeError((err as Error)?.message || "Couldn't load this funnel — try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!expanded && results === null && !loading) loadResults(lookbackDays);
    setExpanded((v) => !v);
  }

  function changeLookback(days: number) {
    if (days === lookbackDays || loading) return;
    setLookbackDays(days);
    setResults(null);
    updateFunnelLookback(funnel.id, days).catch(() => {});
    loadResults(days);
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
          {/* Lookback window — defaults to 30 days, but a flow with a longer
              conversion cycle (sign up week 1, purchase week 6) needs more
              room than that to avoid reading real conversions as drop-off. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">Looking back</span>
            <div className="flex gap-1">
              {LOOKBACK_OPTIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => changeLookback(d)}
                  disabled={loading}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                    lookbackDays === d ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {d} days
                </button>
              ))}
            </div>

            {mpConnected && (
              <div className="flex items-center gap-2 ml-auto">
                {syncState === "done" && syncMsg && (
                  <span className="flex items-center gap-1 text-[11px] text-green-600">
                    <CheckCircle2 size={11} /> {syncMsg}
                  </span>
                )}
                {syncState === "error" && (
                  <span className="flex items-center gap-1 text-[11px] text-red-500" title={syncMsg ?? undefined}>
                    <AlertCircle size={11} /> Sync failed
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSyncMixpanel}
                  disabled={syncState === "syncing" || loading}
                  title="Pull fresh per-occurrence data from Mixpanel for this funnel's events"
                  className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-indigo-600 disabled:opacity-40 transition-colors border border-gray-200 rounded-full px-2.5 py-1"
                >
                  <RefreshCw size={10} className={syncState === "syncing" ? "animate-spin" : ""} />
                  {syncState === "syncing" ? "Syncing…" : "Sync Mixpanel"}
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              Computing…
            </div>
          ) : computeError ? (
            <div className="h-32 flex flex-col items-center justify-center gap-2 text-sm text-center">
              <p className="text-red-500">{computeError}</p>
              <button
                onClick={() => loadResults(lookbackDays)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Try again
              </button>
            </div>
          ) : results ? (
            <>
              {results.some(s => s.data_source === "mixpanel") && results.some(s => s.data_source === "events") && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-3">
                  <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>
                    Some steps use Mixpanel aggregate counts (not per-user sequential data). Conversion % across mixed steps is approximate — sync Mixpanel data for more accurate results.
                  </span>
                </div>
              )}
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
