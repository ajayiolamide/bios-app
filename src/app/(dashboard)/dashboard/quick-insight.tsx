"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, Loader2, Sparkles, RefreshCw, History, ChevronDown } from "lucide-react";
import { getQuickInsight, getLatestBusinessBrief, getBusinessBriefHistory, type BusinessBrief } from "./actions";
import { SaveInsightButton } from "@/components/saved-insights/save-insight-button";

type BriefLine = { emoji: string; label: string; detail: string };

// AI is asked to output "EMOJI|LABEL|DETAIL" lines so we can render them as
// real structured rows. Older saved briefs (or a model that ignores the
// format) won't have the pipes — fall back gracefully and just strip any
// stray markdown so we never show literal asterisks.
function parseBrief(text: string): BriefLine[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const clean = (s: string) => s.replace(/\*\*(.*?)\*\*/g, "$1").replace(/^[-*]\s*/, "").trim();
      const parts = line.split("|");
      if (parts.length >= 3) {
        return { emoji: parts[0].trim(), label: clean(parts[1]), detail: clean(parts.slice(2).join("|")) };
      }
      return { emoji: "💡", label: "", detail: clean(line) };
    });
}

function formatBriefDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function BriefBody({ content }: { content: string }) {
  const lines = parseBrief(content);
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-3 bg-gradient-to-br from-indigo-50/60 to-purple-50/40 border border-indigo-100 rounded-xl px-4 py-3">
          <span className="text-base leading-none mt-0.5">{line.emoji}</span>
          <div className="min-w-0">
            {line.label && <p className="text-sm font-semibold text-gray-800">{line.label}</p>}
            <p className="text-sm text-gray-600 leading-relaxed">{line.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function QuickInsight({ orgId, hasData }: { orgId: string; hasData: boolean }) {
  const [insight, setInsight] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<BusinessBrief[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // On first mount, show the most recent saved brief (if any) instead of
  // forcing the user to regenerate one every time they open the dashboard.
  useEffect(() => {
    if (!orgId) { setInitialLoad(false); return; }
    getLatestBusinessBrief(orgId).then((latest) => {
      if (latest) { setInsight(latest.content); setCreatedAt(latest.created_at); }
      setInitialLoad(false);
    });
  }, [orgId]);

  async function run() {
    setLoading(true); setError(null);
    const res = await getQuickInsight(orgId);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setInsight(res.insight ?? null);
    setCreatedAt(res.createdAt ?? new Date().toISOString());
    setShowHistory(false);
    setHistory([]); // stale — refetch next time history is opened so the new brief shows up
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history.length === 0) {
      setHistoryLoading(true);
      const rows = await getBusinessBriefHistory(orgId, 10);
      setHistory(rows);
      setHistoryLoading(false);
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center">
            <BrainCircuit size={13} className="text-indigo-600" />
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Business Brief</p>
        </div>
        {insight && (
          <div className="flex items-center gap-1">
            <button onClick={toggleHistory}
              className={`p-1.5 rounded-lg transition-colors ${showHistory ? "text-indigo-500 bg-indigo-50" : "text-gray-300 hover:text-indigo-400 hover:bg-indigo-50"}`}
              title="Past briefs">
              <History size={13} />
            </button>
            <button onClick={run} disabled={loading}
              className="p-1.5 text-gray-300 hover:text-indigo-400 transition-colors rounded-lg hover:bg-indigo-50"
              title="Regenerate">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </div>

      {initialLoad && (
        <div className="flex flex-col items-center text-center py-8 gap-3 text-gray-300">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}

      {!initialLoad && !insight && !loading && !error && (
        <div className="flex flex-col items-center text-center py-8 gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
            <Sparkles size={20} className="text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">Get your AI brief</p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs">
              {hasData
                ? "AI reads your connected data and tells you what needs attention right now."
                : "Connect at least one data source first, then generate your brief."}
            </p>
          </div>
          <button onClick={run} disabled={!hasData || loading}
            className="flex items-center gap-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl transition-colors">
            <BrainCircuit size={14} />
            Generate Brief
          </button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center text-center py-8 gap-3 text-gray-400">
          <Loader2 size={22} className="animate-spin text-indigo-400" />
          <p className="text-sm">AI is analysing your data…</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-600">{error}</div>
      )}

      {insight && !loading && !showHistory && (
        <div className="space-y-3">
          <BriefBody content={insight} />
          <div className="flex items-center justify-between">
            <SaveInsightButton orgId={orgId} source="business_brief" content={insight} context={createdAt ? formatBriefDate(createdAt) : undefined} />
            <p className="text-[11px] text-gray-300">
              {createdAt ? formatBriefDate(createdAt) : "Generated just now"} · AI may make mistakes
            </p>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="space-y-2">
          {historyLoading && (
            <div className="flex justify-center py-6 text-gray-300"><Loader2 size={16} className="animate-spin" /></div>
          )}
          {!historyLoading && history.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">No past briefs yet.</p>
          )}
          {!historyLoading && history.map((b) => {
            const expanded = expandedId === b.id;
            const firstLine = parseBrief(b.content)[0];
            return (
              <div key={b.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : b.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm">{firstLine?.emoji ?? "💡"}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{firstLine?.label || firstLine?.detail || "Brief"}</p>
                      <p className="text-[11px] text-gray-400">{formatBriefDate(b.created_at)}</p>
                    </div>
                  </div>
                  <ChevronDown size={14} className={`text-gray-300 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded && (
                  <div className="px-3 pb-3">
                    <BriefBody content={b.content} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
