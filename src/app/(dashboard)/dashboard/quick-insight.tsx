"use client";

import { useState } from "react";
import { BrainCircuit, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { getQuickInsight } from "./actions";

export function QuickInsight({ orgId, hasData }: { orgId: string; hasData: boolean }) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    const res = await getQuickInsight(orgId);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setInsight(res.insight ?? null);
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
          <button onClick={run} disabled={loading}
            className="p-1.5 text-gray-300 hover:text-indigo-400 transition-colors rounded-lg hover:bg-indigo-50">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {!insight && !loading && !error && (
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

      {insight && !loading && (
        <div className="space-y-3">
          <div className="bg-gradient-to-br from-indigo-50/60 to-purple-50/40 border border-indigo-100 rounded-xl px-4 py-4">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{insight}</p>
          </div>
          <p className="text-[11px] text-gray-300 text-right">Generated just now · AI may make mistakes</p>
        </div>
      )}
    </div>
  );
}
