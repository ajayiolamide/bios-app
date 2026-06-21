"use client";

import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, GripVertical, Loader2, Zap, ChevronDown, Search } from "lucide-react";
import { createFunnel, type FunnelStep } from "@/app/actions/funnels";
import { getEventNamesWithSource, type EventNameWithSource } from "@/app/actions/events";
import { getMixpanelSettings, syncMixpanelEventNames } from "@/app/actions/mixpanel";

interface Props {
  orgId: string;
  onCreated: () => void;
  onClose: () => void;
}

type SourceFilter = "all" | "csv" | "mixpanel" | "sdk";

const SOURCE_LABELS: Record<string, string> = {
  csv: "📄 CSV",
  mixpanel: "📊 Mixpanel",
  sdk: "⚡ SDK",
};

function sourceBadge(source: EventNameWithSource["source"]) {
  if (!source) return null;
  const label = SOURCE_LABELS[source] ?? source;
  const cls =
    source === "csv" ? "bg-blue-50 text-blue-600 border-blue-100"
    : source === "mixpanel" ? "bg-purple-50 text-purple-600 border-purple-100"
    : "bg-emerald-50 text-emerald-600 border-emerald-100";
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

// ─── Event picker (searchable combobox) ───────────────────────────────────────

function EventPicker({
  value,
  events,
  sourceFilter,
  onChange,
  placeholder,
}: {
  value: string;
  events: EventNameWithSource[];
  sourceFilter: SourceFilter;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const filtered = events.filter(e => {
    if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
    if (search.trim()) return e.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const selected = events.find(e => e.name === value);

  return (
    <div ref={ref} className="relative flex-1">
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-left hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors"
      >
        {selected ? (
          <div className="flex items-center gap-2 min-w-0">
            <Zap size={12} className="text-indigo-400 flex-shrink-0" />
            <code className="text-xs text-indigo-600 font-mono truncate">{selected.name}</code>
            {sourceBadge(selected.source)}
          </div>
        ) : (
          <span className="text-gray-400 text-sm">{placeholder}</span>
        )}
        <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search events…"
              className="flex-1 text-sm outline-none placeholder-gray-400"
            />
          </div>

          {/* List */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">No events match</p>
            ) : (
              filtered.map(ev => (
                <button
                  key={ev.name}
                  type="button"
                  onClick={() => { onChange(ev.name); setOpen(false); setSearch(""); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 transition-colors ${ev.name === value ? "bg-indigo-50" : ""}`}
                >
                  <Zap size={11} className="text-indigo-400 flex-shrink-0" />
                  <code className="text-xs text-indigo-700 font-mono flex-1 truncate">{ev.name}</code>
                  {sourceBadge(ev.source)}
                </button>
              ))
            )}
          </div>

          {/* Type custom name */}
          {search.trim() && !filtered.find(e => e.name === search.trim()) && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => { onChange(search.trim()); setOpen(false); setSearch(""); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
              >
                <Plus size={11} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-600">Use <code className="font-mono text-indigo-600">{search.trim()}</code></span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

export function CreateFunnelDialog({ orgId, onCreated, onClose }: Props) {
  const [events, setEvents]           = useState<EventNameWithSource[]>([]);
  const [syncing, setSyncing]         = useState(true);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps]             = useState<FunnelStep[]>([{ event_name: "" }, { event_name: "" }]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Load events, auto-sync Mixpanel if connected
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setSyncing(true);
      // Sync Mixpanel event names if connected
      const { connected } = await getMixpanelSettings(orgId);
      if (connected && !cancelled) {
        await syncMixpanelEventNames(orgId).catch(() => {});
      }
      if (!cancelled) {
        const data = await getEventNamesWithSource(orgId);
        setEvents(data);
        setSyncing(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [orgId]);

  // Sources available in data
  const availableSources = [...new Set(events.map(e => e.source).filter(Boolean))] as string[];

  function updateStep(i: number, v: string) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { event_name: v } : s));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const filled = steps.filter(s => s.event_name.trim());
    if (filled.length < 2) { setError("Add at least 2 steps"); return; }
    setLoading(true);
    setError(null);
    const { error: err } = await createFunnel(orgId, { name, description, steps: filled });
    setLoading(false);
    if (err) { setError(err); return; }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 flex-shrink-0">
          <h2 className="font-semibold text-gray-900 text-lg">New funnel</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 overflow-y-auto flex-1">

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Funnel name</label>
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. Signup to first claim"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="What are you measuring?"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Source filter */}
          {availableSources.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Show events from</label>
              <div className="flex gap-1.5 flex-wrap">
                {(["all", ...availableSources] as SourceFilter[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSourceFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      sourceFilter === s
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {s === "all" ? "All sources" : SOURCE_LABELS[s] ?? s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Steps (in order)</label>
              {syncing && (
                <span className="flex items-center gap-1 text-[11px] text-gray-400">
                  <Loader2 size={10} className="animate-spin" /> Syncing events…
                </span>
              )}
              {!syncing && events.length > 0 && (
                <span className="text-[11px] text-gray-400">{events.length} events available</span>
              )}
            </div>

            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <GripVertical size={16} className="text-gray-300 flex-shrink-0" />
                <span className="text-xs text-gray-400 w-5 text-center font-mono">{i + 1}</span>
                <EventPicker
                  value={step.event_name}
                  events={events}
                  sourceFilter={sourceFilter}
                  onChange={v => updateStep(i, v)}
                  placeholder={`Step ${i + 1} — select or type event`}
                />
                <button
                  type="button"
                  onClick={() => setSteps(prev => prev.filter((_, idx) => idx !== i))}
                  disabled={steps.length <= 2}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 disabled:opacity-20 transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setSteps(prev => [...prev, { event_name: "" }])}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-indigo-600 transition-colors"
            >
              <Plus size={14} /> Add step
            </button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              {loading ? "Creating…" : "Create funnel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
