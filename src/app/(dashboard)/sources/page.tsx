"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useOrg } from "@/contexts/org-context";
import {
  getReportSources, saveReportSource, deleteReportSource, fetchSheetData,
} from "@/app/actions/reports";
import { getMixpanelSettings, syncMixpanelEventNames } from "@/app/actions/mixpanel";
import { getAmplitudeSettings, syncAmplitudeEventNames } from "@/app/actions/amplitude";
import type { ReportSource } from "@/types/database";
import {
  Database, Plus, Trash2, RefreshCw, ExternalLink, Loader2,
  Table, Link, CheckCircle2, X, Plug, Webhook, AlertCircle, ArrowRight,
} from "lucide-react";

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function rowHash(rows: Record<string, string>[]): string {
  if (!rows.length) return "0";
  const sample = [rows[0], rows[rows.length - 1]].map(r => Object.values(r).join("|")).join("||");
  return `${rows.length}::${sample}`;
}

const COMING_SOON = [
  { name: "PostgreSQL" },
  { name: "MySQL" },
  { name: "Stripe" },
  { name: "HubSpot" },
  { name: "Webhooks" },
  { name: "REST API" },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";

  const [sources, setSources] = useState<ReportSource[]>([]);
  const [sourceData, setSourceData] = useState<Record<string, { rows: Record<string, string>[]; headers: string[]; hash: string; lastSynced: string }>>({});
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [liveSync, setLiveSync] = useState(false);
  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);

  // Mixpanel connector state
  const [mpConnected, setMpConnected] = useState(false);
  const [mpSyncing, setMpSyncing] = useState(false);
  const [mpResult, setMpResult] = useState<{ synced: number; total: number } | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);

  // Amplitude connector state
  const [ampConnected, setAmpConnected] = useState(false);
  const [ampSyncing, setAmpSyncing] = useState(false);
  const [ampResult, setAmpResult] = useState<{ synced: number; total: number } | null>(null);
  const [ampError, setAmpError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [data, mp, amp] = await Promise.all([
      getReportSources(orgId),
      getMixpanelSettings(orgId),
      getAmplitudeSettings(orgId),
    ]);
    setSources(data);
    setMpConnected(mp.connected);
    setAmpConnected(amp.connected);
    for (const s of data) {
      if (s.cached_data) {
        const rows = s.cached_data as Record<string, string>[];
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
        setSourceData(prev => ({
          ...prev,
          [s.id]: prev[s.id] ? { ...prev[s.id], rows, headers } : {
            rows, headers, hash: rowHash(rows), lastSynced: s.last_fetched_at ?? "",
          },
        }));
      }
    }
  }, [orgId]);

  const handleMixpanelSync = async () => {
    setMpSyncing(true); setMpError(null); setMpResult(null);
    const res = await syncMixpanelEventNames(orgId);
    setMpSyncing(false);
    if (res.error) { setMpError(res.error); return; }
    setMpResult({ synced: res.synced, total: res.total });
  };

  const handleAmplitudeSync = async () => {
    setAmpSyncing(true); setAmpError(null); setAmpResult(null);
    const res = await syncAmplitudeEventNames(orgId);
    setAmpSyncing(false);
    if (res.error) { setAmpError(res.error); return; }
    setAmpResult({ synced: res.synced, total: res.total });
  };

  useEffect(() => { load(); }, [load]);

  const handleSync = async (sourceId: string) => {
    setSyncing(sourceId); setError(null);
    const { rows, headers, error: err } = await fetchSheetData(sourceId);
    setSyncing(null);
    if (err) { setError(err); return; }
    const newHash = rowHash(rows);
    setSourceData(prev => {
      const existing = prev[sourceId];
      const didChange = existing && existing.hash !== newHash;
      if (didChange) setChanged(c => ({ ...c, [sourceId]: true }));
      return { ...prev, [sourceId]: { rows, headers, hash: newHash, lastSynced: new Date().toISOString() } };
    });
    await load();
  };

  // Auto-poll
  useEffect(() => {
    if (!liveSync) return;
    const id = setInterval(async () => {
      for (const s of sourcesRef.current) {
        const { rows, headers, error: err } = await fetchSheetData(s.id);
        if (err || !rows.length) continue;
        const newHash = rowHash(rows);
        setSourceData(prev => {
          if (prev[s.id]?.hash === newHash) return prev;
          setChanged(c => ({ ...c, [s.id]: true }));
          return { ...prev, [s.id]: { rows, headers, hash: newHash, lastSynced: new Date().toISOString() } };
        });
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [liveSync]);

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true); setError(null);
    const { id, error: err } = await saveReportSource(orgId, name, url);
    if (err) { setError(err); setAdding(false); return; }
    setName(""); setUrl("");
    await load();
    if (id) await handleSync(id);
    setAdding(false);
  };

  if (!currentOrg) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
      Select an organisation to manage sources.
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database size={22} className="text-indigo-500" /> Sources
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect your data. Everything you plug in here feeds into Analytics, Intelligence, and Reports.
        </p>
      </div>

      {/* Active connections */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Table size={14} className="text-green-500" /> Google Sheets
            <span className="text-xs font-normal text-gray-400">— publish as CSV and paste the URL</span>
          </h2>
          {sources.length > 0 && (
            <button onClick={() => setLiveSync(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${liveSync ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${liveSync ? "bg-green-500" : "bg-gray-400"}`} />
              {liveSync ? "Live sync on · 30s" : "Enable live sync"}
            </button>
          )}
        </div>

        {/* Add form */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Source name (e.g. Q3 Sales)"
              className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Published CSV URL"
              className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <button onClick={handleAdd} disabled={adding || !name.trim() || !url.trim()}
              className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add & Sync
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2.5">
            Google Sheets → File → Share → Publish to web → CSV → Publish. Paste that URL above.
          </p>
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>

        {/* Source cards */}
        {sources.length === 0 ? (
          <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
            <Link size={28} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No sources yet</p>
            <p className="text-xs mt-1">Add your first Google Sheet above to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map(source => {
              const sd = sourceData[source.id];
              const lastSynced = sd?.lastSynced || source.last_fetched_at;
              return (
                <div key={source.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* Changed banner */}
                  {changed[source.id] && (
                    <div className="flex items-center justify-between px-5 py-2 bg-green-50 border-b border-green-100">
                      <p className="text-xs text-green-700 font-medium flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-green-500" /> Data updated — {sd?.rows.length} rows loaded
                      </p>
                      <button onClick={() => setChanged(c => ({ ...c, [source.id]: false }))} className="text-green-400 hover:text-green-600">
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Table size={15} className="text-green-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800">{source.name}</p>
                          {liveSync && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">LIVE</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-gray-400">
                            {lastSynced ? `Synced ${timeAgo(lastSynced)}` : "Not synced yet"}
                          </p>
                          {sd?.rows.length ? (
                            <span className="text-xs text-indigo-500 font-medium">{sd.rows.length.toLocaleString()} rows · {sd.headers.length} columns</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a href={source.sheet_url} target="_blank" rel="noreferrer"
                        className="p-2 text-gray-400 hover:text-indigo-600 transition-colors" title="Open sheet">
                        <ExternalLink size={14} />
                      </a>
                      <button onClick={() => handleSync(source.id)} disabled={syncing === source.id}
                        className="p-2 text-gray-400 hover:text-indigo-600 transition-colors" title="Sync now">
                        <RefreshCw size={14} className={syncing === source.id ? "animate-spin text-indigo-500" : ""} />
                      </button>
                      <button onClick={async () => { await deleteReportSource(source.id); await load(); }}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Column preview */}
                  {sd?.headers.length ? (
                    <div className="px-5 pb-4">
                      <div className="flex flex-wrap gap-1.5">
                        {sd.headers.slice(0, 12).map(h => (
                          <span key={h} className="text-[11px] px-2 py-0.5 bg-gray-50 border border-gray-100 rounded-md text-gray-500 font-mono">{h}</span>
                        ))}
                        {sd.headers.length > 12 && <span className="text-[11px] text-gray-400">+{sd.headers.length - 12} more</span>}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mixpanel connector */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <span className="text-base">📊</span> Mixpanel
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {mpConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm font-medium text-gray-700">Connected</span>
                </div>
                <button
                  onClick={handleMixpanelSync}
                  disabled={mpSyncing}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {mpSyncing
                    ? <><Loader2 size={14} className="animate-spin" /> Syncing…</>
                    : <><RefreshCw size={14} /> Sync Event Names</>}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Pulls your top event names from the last 90 days and adds any new ones to Metrik Events.
                Once synced, they appear as autocomplete suggestions across Feature Metrics and Funnels.
              </p>
              {mpResult && (mpResult.synced > 0 || mpResult.total > 0) && (
                <div className="flex items-center gap-2 text-xs bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-700">
                  <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                  {mpResult.synced > 0
                    ? <span>Added <strong>{mpResult.synced}</strong> new event{mpResult.synced !== 1 ? "s" : ""} out of {mpResult.total} found in Mixpanel.</span>
                    : <span>All <strong>{mpResult.total}</strong> Mixpanel events already in Metrik — nothing new to add.</span>}
                </div>
              )}
              {mpResult && mpResult.synced === 0 && mpResult.total === 0 && (
                <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-700">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Mixpanel returned <strong>0</strong> events for this project in the last 90 days — this isn&apos;t a Metrik issue, Mixpanel itself has nothing to sync. Check the Project ID, data region (US/EU), and that this Service Account has access to that specific project.
                  </span>
                </div>
              )}
              {mpError && (
                <div className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-red-600">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{mpError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-700">Mixpanel not connected</p>
                <p className="text-xs text-gray-400 mt-0.5">Add your Service Account credentials in Settings to enable event name sync.</p>
              </div>
              <a href="/settings" className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 flex-shrink-0">
                Go to Settings <ArrowRight size={14} />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Amplitude connector */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <span className="text-base">📈</span> Amplitude
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {ampConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm font-medium text-gray-700">Connected</span>
                </div>
                <button
                  onClick={handleAmplitudeSync}
                  disabled={ampSyncing}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {ampSyncing
                    ? <><Loader2 size={14} className="animate-spin" /> Syncing…</>
                    : <><RefreshCw size={14} /> Sync Event Names</>}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Pulls event names via Amplitude&apos;s Taxonomy API and adds any new ones to Metrik Events.
                That API needs to be enabled by Amplitude for your plan — if it isn&apos;t yet, you&apos;ll see a clear message below instead of a silent failure.
              </p>
              {ampResult && (ampResult.synced > 0 || ampResult.total > 0) && (
                <div className="flex items-center gap-2 text-xs bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-700">
                  <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                  {ampResult.synced > 0
                    ? <span>Added <strong>{ampResult.synced}</strong> new event{ampResult.synced !== 1 ? "s" : ""} out of {ampResult.total} found in Amplitude.</span>
                    : <span>All <strong>{ampResult.total}</strong> Amplitude events already in Metrik — nothing new to add.</span>}
                </div>
              )}
              {ampResult && ampResult.synced === 0 && ampResult.total === 0 && (
                <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-700">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>Amplitude returned <strong>0</strong> event types — check the data region and that this project actually has tracked events.</span>
                </div>
              )}
              {ampError && (
                <div className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-red-600">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{ampError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-700">Amplitude not connected</p>
                <p className="text-xs text-gray-400 mt-0.5">Add your API Key and Secret Key in Settings to enable event name sync.</p>
              </div>
              <a href="/settings" className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 flex-shrink-0">
                Go to Settings <ArrowRight size={14} />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Coming soon connectors — a single compact line instead of seven
          grayed-out cards. Seven half-opacity boxes of things that don't
          exist yet read as filler, not roadmap. */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-2.5">
          <Plug size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-600">
              More native connectors coming: {COMING_SOON.map(c => c.name).join(", ")}.
            </p>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
              <Webhook size={11} className="flex-shrink-0" />
              Need one today? Anything that exports CSV or calls a webhook can feed in via Google Sheets above.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
