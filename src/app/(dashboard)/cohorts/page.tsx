"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useOrg } from "@/contexts/org-context";
import {
  getCohortRetention, getWeeklyActiveUsers, getTopEvents,
  getCohortDataInfo, parseCohortFromPrompt, getCohortInsight, getCohortConversion,
  type CohortData, type WAURow, type TopEventRow, type CohortDataInfo, type CohortFilter,
  type CohortConversionResult,
} from "@/app/actions/cohorts";
import { getDistinctEventNames, getEventNamesWithSource, type EventNameWithSource } from "@/app/actions/events";
import { getMixpanelSettings, syncMixpanelEventNames, syncMixpanelRawEvents } from "@/app/actions/mixpanel";
import { SaveInsightButton } from "@/components/saved-insights/save-insight-button";
import { getMyOrgFlags } from "@/app/actions/flags";
import { LockedFeature } from "@/components/locked-feature";
import {
  Users, TrendingUp, Zap, RefreshCw, ChevronDown, Sparkles,
  Filter, MessageSquare, Database, Loader2, X, Search,
  Bookmark, BookmarkCheck, Trash2, ChevronRight, Plus, Pencil,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtWeek(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}
// How many weeks have actually elapsed since this cohort's own start week —
// used to tell "this week hasn't happened yet for this cohort" (blank, grey)
// apart from "this week happened and retention was genuinely 0%" (shown as
// 0%, not blank). Approximate day-based math is fine here; cohortWeek is
// already Monday-aligned from the server.
function weeksElapsed(cohortWeekIso: string): number {
  return Math.floor((Date.now() - new Date(cohortWeekIso).getTime()) / (7 * 86400000)) + 1;
}
function heatColor(p: number, isWeek0: boolean) {
  if (isWeek0) return "bg-indigo-600 text-white";
  if (p === 0)   return "bg-gray-50 text-gray-300";
  if (p < 10)    return "bg-red-50 text-red-400";
  if (p < 25)    return "bg-orange-50 text-orange-500";
  if (p < 40)    return "bg-amber-50 text-amber-600";
  if (p < 60)    return "bg-lime-50 text-lime-700";
  if (p < 80)    return "bg-emerald-100 text-emerald-700";
  return "bg-emerald-500 text-white";
}

const SOURCE_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  csv:      { label: "CSV",      cls: "bg-blue-100 text-blue-700 border-blue-200",     dot: "bg-blue-400" },
  mixpanel: { label: "Mixpanel", cls: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-400" },
  sdk:      { label: "SDK",      cls: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-400" },
};

function SourceBadge({ source }: { source: string | null }) {
  if (!source || !SOURCE_CFG[source]) return null;
  const { label, cls } = SOURCE_CFG[source];
  return (
    <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

// ─── Saved cohort persistence ─────────────────────────────────────────────────

type SavedCohort = {
  id: string;
  name: string;
  filter: CohortFilter;
  createdAt: string;
};

function loadSaved(orgId: string): SavedCohort[] {
  try { return JSON.parse(localStorage.getItem(`bios_cohorts_${orgId}`) ?? "[]"); }
  catch { return []; }
}
function persistSaved(orgId: string, cohorts: SavedCohort[]) {
  localStorage.setItem(`bios_cohorts_${orgId}`, JSON.stringify(cohorts));
}

// ─── Searchable event picker ───────────────────────────────────────────────────
// Shared by the first-event and second-event pickers in the cohort builder.
// The synced event list is never guaranteed to be complete — Mixpanel's
// names sync only returns its top 255 events by volume over the last 31
// days, and raw per-occurrence sync only ever happens for an event AFTER a
// cohort already references it. A real, valid event (especially a brand-new
// one, or one that's only fired a handful of times) can legitimately be
// missing from the list. Rather than leaving that event unreachable, typing
// its exact name and choosing "Use ..." accepts it directly — applying the
// cohort then syncs real occurrences for it via the existing
// ensureEventsSynced flow, regardless of whether it was ever in the cache.
function EventPicker({
  events, eventsLoading, value, onChange, placeholder = "All events",
}: {
  events: EventNameWithSource[];
  eventsLoading: boolean;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [showList, setShowList] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMyOrgFlags()
      .then(f => { setLocked(!f.cohorts_enabled); setFlagChecked(true); })
      .catch(() => { setLocked(false); setFlagChecked(true); });
  }, []);

  useEffect(() => {
    if (!showList) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowList(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showList]);

  const filtered = events.filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()));
  const selected = events.find(e => e.name === value);
  const exactMatch = events.some(e => e.name.toLowerCase() === search.trim().toLowerCase());
  const showCustomOption = search.trim().length > 0 && !exactMatch;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setShowList(!showList); setSearch(""); }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm border border-gray-200 rounded-xl hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
      >
        <div className="flex items-center gap-2 min-w-0">
          {value ? (
            <>
              <code className="text-xs font-mono text-indigo-600 truncate">{value}</code>
              {selected ? <SourceBadge source={selected.source} /> : (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">not synced yet</span>
              )}
            </>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </div>
        {eventsLoading
          ? <Loader2 size={13} className="text-gray-400 animate-spin flex-shrink-0" />
          : <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
        }
      </button>

      {showList && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search size={12} className="text-gray-400 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search, or type an exact event name…"
              className="flex-1 text-sm outline-none placeholder-gray-400"
            />
            {search && <button onClick={() => setSearch("")}><X size={12} className="text-gray-400" /></button>}
          </div>
          <div className="max-h-52 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(""); setShowList(false); }}
              className={`w-full flex items-center px-3 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${!value ? "text-indigo-600 font-medium" : "text-gray-400 italic"}`}
            >
              {placeholder}
            </button>
            {showCustomOption && (
              <button
                type="button"
                onClick={() => { onChange(search.trim()); setShowList(false); setSearch(""); }}
                className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-amber-50 transition-colors border-y border-amber-100 bg-amber-50/40"
              >
                <Plus size={12} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="text-xs text-gray-700 leading-snug">
                  Use <code className="font-mono text-amber-700">{search.trim()}</code>
                  <span className="text-gray-400"> — not in the synced list yet, will sync on apply</span>
                </span>
              </button>
            )}
            {eventsLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Loading events…
              </div>
            ) : filtered.length === 0 && !showCustomOption ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">No events match</p>
            ) : (
              filtered.map(ev => (
                <button
                  key={ev.name}
                  type="button"
                  onClick={() => { onChange(ev.name); setShowList(false); setSearch(""); }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-indigo-50 transition-colors ${ev.name === value ? "bg-indigo-50" : ""}`}
                >
                  <code className={`text-xs font-mono truncate flex-1 ${ev.name === value ? "text-indigo-600" : "text-gray-700"}`}>{ev.name}</code>
                  <SourceBadge source={ev.source} />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cohort builder modal ─────────────────────────────────────────────────────

function CohortBuilderModal({
  orgId,
  initialFilter,
  onApply,
  onClose,
}: {
  orgId: string;
  // When set, the modal opens pre-filled with this filter's values instead of
  // blank — used to let someone fix a cohort's event mapping (e.g. "this
  // points at the wrong event name") without rebuilding the whole thing from
  // scratch.
  initialFilter?: CohortFilter | null;
  onApply: (filter: CohortFilter) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"prompt" | "raw">(initialFilter ? "raw" : "prompt");
  const [promptText, setPromptText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");

  // Events — load independently inside this modal
  const [events, setEvents] = useState<EventNameWithSource[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [rawEvent, setRawEvent] = useState(initialFilter?.eventName ?? "");
  const [rawMin, setRawMin]   = useState(initialFilter?.minOccurrences ?? 1);

  // Two-step condition — "did rawEvent, THEN secondEvent, within N days, for
  // the same user." Without this a raw-mode cohort can only ever express a
  // single event with a minimum count.
  const [twoStep, setTwoStep] = useState(!!initialFilter?.secondEventName);
  const [secondEvent, setSecondEvent] = useState(initialFilter?.secondEventName ?? "");
  const [withinDays, setWithinDays] = useState(initialFilter?.withinDays ?? 7);

  // Load events on mount — sync Mixpanel first so event names appear
  useEffect(() => {
    let cancelled = false;
    async function loadEvents() {
      setEventsLoading(true);
      try {
        // Sync Mixpanel event names if connected (non-blocking on error)
        const { connected } = await getMixpanelSettings(orgId);
        if (connected && !cancelled) {
          await syncMixpanelEventNames(orgId).catch(() => {});
        }
        if (cancelled) return;
        const withSource = await getEventNamesWithSource(orgId);
        if (!cancelled) {
          if (withSource.length > 0) {
            setEvents(withSource);
          } else {
            const names = await getDistinctEventNames(orgId);
            setEvents(names.map(n => ({ name: n, source: null })));
          }
        }
      } catch {
        try {
          const names = await getDistinctEventNames(orgId);
          if (!cancelled) setEvents(names.map(n => ({ name: n, source: null })));
        } catch { /* empty */ }
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }
    loadEvents();
    return () => { cancelled = true; };
  }, [orgId]);

  async function handlePromptApply() {
    if (!promptText.trim()) return;
    setParsing(true);
    setParseError("");
    const { filter, error } = await parseCohortFromPrompt(promptText, events.map(e => e.name));
    setParsing(false);
    if (error || !filter) { setParseError(error ?? "Could not parse — try rephrasing."); return; }
    onApply(filter);
  }

  function handleRawApply() {
    if (twoStep && rawEvent && secondEvent) {
      onApply({
        eventName: rawEvent,
        minOccurrences: rawMin,
        secondEventName: secondEvent,
        withinDays,
        description: `Users who fired "${rawEvent}" and then "${secondEvent}" within ${withinDays} day${withinDays > 1 ? "s" : ""}`,
      });
      return;
    }
    onApply({
      eventName: rawEvent || null,
      minOccurrences: rawMin,
      description: rawEvent
        ? `Users who fired "${rawEvent}" at least ${rawMin}×`
        : `All active users (at least ${rawMin} event${rawMin > 1 ? "s" : ""})`,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{initialFilter ? "Edit cohort" : "Build cohort"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {([
            { id: "prompt" as const, label: "Describe it (AI)", icon: MessageSquare },
            { id: "raw"    as const, label: "Build manually",   icon: Filter },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                mode === id ? "border-indigo-500 text-indigo-700" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {mode === "prompt" ? (
            <div className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Describe who you want in plain English. AI will figure out the event filter for you.
              </p>
              <div className="space-y-2">
                <div className="relative">
                  <Sparkles size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400" />
                  <input
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handlePromptApply(); }}
                    placeholder="e.g. users who visited ratings page at least twice"
                    className="w-full pl-8 pr-3 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-300"
                  />
                </div>
                {/* Show available events as hints */}
                {!eventsLoading && events.length > 0 && (
                  <p className="text-[11px] text-gray-400">
                    Available events: {events.slice(0, 5).map(e => (
                      <code key={e.name} className="font-mono bg-gray-100 px-1 rounded mx-0.5">{e.name}</code>
                    ))}{events.length > 5 && ` +${events.length - 5} more`}
                  </p>
                )}
              </div>
              {parseError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{parseError}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Pick a specific event and set how many times the user must have fired it.
              </p>

              {/* Event picker */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Event <span className="text-gray-400">(optional)</span></label>
                <EventPicker events={events} eventsLoading={eventsLoading} value={rawEvent} onChange={setRawEvent} placeholder="All events" />
              </div>

              {/* Min occurrences */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Min occurrences</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={1} value={rawMin}
                    onChange={e => setRawMin(Math.max(1, Number(e.target.value)))}
                    className="w-28 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <span className="text-xs text-gray-400">
                    = users who fired {rawEvent ? <code className="font-mono bg-gray-100 px-1 rounded">{rawEvent}</code> : "any event"} at least {rawMin}×
                  </span>
                </div>
              </div>

              {/* Two-step condition */}
              <div className="pt-3 border-t border-gray-100">
                {!twoStep ? (
                  <button
                    type="button"
                    onClick={() => setTwoStep(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <Plus size={12} /> Then check for a second event within N days
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-600">
                        Then fired… <span className="text-gray-400">(within N days, same user)</span>
                      </label>
                      <button type="button" onClick={() => { setTwoStep(false); setSecondEvent(""); }} className="text-gray-300 hover:text-gray-500">
                        <X size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <EventPicker events={events} eventsLoading={eventsLoading} value={secondEvent} onChange={setSecondEvent} placeholder="Select event…" />
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">within</span>
                      <input
                        type="number" min={1} value={withinDays}
                        onChange={e => setWithinDays(Math.max(1, Number(e.target.value)))}
                        className="w-16 px-2 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <span className="text-xs text-gray-400 flex-shrink-0">days</span>
                    </div>
                    {!rawEvent && (
                      <p className="text-[11px] text-amber-600">Pick a first event above — a two-step cohort needs both.</p>
                    )}
                    <p className="text-[11px] text-gray-400">
                      = % of users who fired {rawEvent ? <code className="font-mono bg-gray-100 px-1 rounded">{rawEvent}</code> : "the first event"} who also fired{" "}
                      {secondEvent ? <code className="font-mono bg-gray-100 px-1 rounded">{secondEvent}</code> : "the second event"} within {withinDays} day{withinDays > 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl transition-colors">
            Cancel
          </button>
          {mode === "prompt" ? (
            <button
              onClick={handlePromptApply}
              disabled={parsing || !promptText.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {parsing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {parsing ? "Parsing…" : "Generate cohort"}
            </button>
          ) : (
            <button
              onClick={handleRawApply}
              disabled={twoStep && (!rawEvent || !secondEvent)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              <Filter size={13} /> {initialFilter ? "Save changes" : "Apply cohort"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Save name dialog ─────────────────────────────────────────────────────────

function SaveNameDialog({
  filter,
  onSave,
  onSkip,
}: {
  filter: CohortFilter;
  onSave: (name: string) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(filter.description.slice(0, 50));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bookmark size={16} className="text-indigo-500" />
          <h3 className="text-base font-semibold text-gray-900">Save this cohort?</h3>
        </div>
        <p className="text-xs text-gray-400 mb-4">{filter.description}</p>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); if (e.key === "Escape") onSkip(); }}
          placeholder="Cohort name…"
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onSkip} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl transition-colors">
            Skip
          </button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
          >
            <Bookmark size={13} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Event filter dropdown (header) ──────────────────────────────────────────

function EventFilterDropdown({
  value, events, onChange,
}: {
  value: string;
  events: EventNameWithSource[];
  onChange: (v: string) => void;
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

  const filtered = events.filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()));
  const sel = events.find(e => e.name === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="flex items-center gap-2 bg-white border border-gray-200 text-sm rounded-xl pl-3 pr-8 py-2 hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[220px]"
      >
        {sel ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <code className="text-xs font-mono text-indigo-600 truncate">{sel.name}</code>
            <SourceBadge source={sel.source} />
          </div>
        ) : <span className="text-gray-500 text-sm">All events</span>}
        <ChevronDown size={13} className="absolute right-2.5 text-gray-400 pointer-events-none" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-[260px] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search size={12} className="text-gray-400 flex-shrink-0" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="flex-1 text-sm outline-none placeholder-gray-400" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <button onClick={() => { onChange(""); setOpen(false); }} className={`w-full flex items-center px-3 py-2.5 text-sm text-left hover:bg-gray-50 ${!value ? "text-indigo-600 font-medium" : "text-gray-400 italic"}`}>
              All events
            </button>
            {filtered.map(ev => (
              <button
                key={ev.name}
                onClick={() => { onChange(ev.name); setOpen(false); setSearch(""); }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-indigo-50 transition-colors ${ev.name === value ? "bg-indigo-50" : ""}`}
              >
                <code className={`text-xs font-mono truncate flex-1 ${ev.name === value ? "text-indigo-600" : "text-gray-700"}`}>{ev.name}</code>
                <SourceBadge source={ev.source} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Saved cohorts sidebar strip ──────────────────────────────────────────────

function SavedCohortsStrip({
  cohorts, activeCohortId, onSelect, onDelete,
}: {
  cohorts: SavedCohort[];
  activeCohortId: string | null;
  onSelect: (c: SavedCohort) => void;
  onDelete: (id: string) => void;
}) {
  if (!cohorts.length) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex-shrink-0">
        <BookmarkCheck size={12} /> Saved
      </div>
      {cohorts.map(c => (
        <div
          key={c.id}
          className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium cursor-pointer transition-colors ${
            activeCohortId === c.id
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
          }`}
          onClick={() => onSelect(c)}
        >
          {activeCohortId === c.id && <ChevronRight size={11} className="text-indigo-200" />}
          <span className="truncate max-w-[140px]">{c.name}</span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(c.id); }}
            className={`opacity-0 group-hover:opacity-100 ml-0.5 transition-opacity ${activeCohortId === c.id ? "text-indigo-300 hover:text-white" : "text-gray-300 hover:text-red-400"}`}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Data info bar ────────────────────────────────────────────────────────────

function DataInfoBar({ info, loading }: { info: CohortDataInfo | null; loading: boolean }) {
  if (loading) return (
    <div className="flex items-center gap-4 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl">
      {[...Array(3)].map((_, i) => <div key={i} className="h-4 w-24 bg-slate-200 animate-pulse rounded" />)}
    </div>
  );
  if (!info) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-xs">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Database size={12} />
        <span className="font-semibold uppercase tracking-wider text-[10px]">Data window</span>
      </div>
      <span className="text-slate-700 font-semibold">{info.totalEvents.toLocaleString()} <span className="font-normal text-slate-400">events</span></span>
      <span className="text-slate-700 font-semibold">{info.totalUsers.toLocaleString()} <span className="font-normal text-slate-400">users</span></span>
      <span className="text-slate-400">{fmtDate(info.dateFrom)} → {fmtDate(info.dateTo)}</span>
      {info.bySource.length > 0 && (
        <div className="flex items-center gap-1.5 ml-auto">
          {info.bySource.filter(s => s.source !== "unknown").map(({ source, count }) => (
            <span key={source} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${SOURCE_CFG[source]?.cls ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {SOURCE_CFG[source]?.label ?? source} · {count.toLocaleString()}
            </span>
          ))}
          {info.bySource.filter(s => s.source === "unknown" || !SOURCE_CFG[s.source]).length > 0 && (
            <span className="text-[10px] text-slate-400">
              +{info.bySource.filter(s => !SOURCE_CFG[s.source]).reduce((a, b) => a + b.count, 0).toLocaleString()} untagged
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mb-3">
        {tab === "retention" ? <Users size={20} className="text-gray-400" />
          : tab === "active" ? <TrendingUp size={20} className="text-gray-400" />
          : <Zap size={20} className="text-gray-400" />}
      </div>
      <p className="text-sm font-medium text-gray-600 mb-1">No data yet</p>
      <p className="text-xs text-gray-400 max-w-[260px] leading-relaxed">
        Import events with a <code className="font-mono bg-gray-100 px-1 rounded">user_id</code> field.{" "}
        <a href="/events" className="text-indigo-500 hover:underline">Go to Events →</a>
      </p>
    </div>
  );
}

// ─── Retention grid ───────────────────────────────────────────────────────────

function RetentionGrid({ data, qualifyingEvent }: { data: CohortData; qualifyingEvent: string }) {
  if (!data.rows.length) return <EmptyState tab="retention" />;
  const cols = Math.min(data.maxWeeks, 12);

  // Only average in cohorts that have actually reached week w — retained[]
  // is always padded to the full requested window, so without this check a
  // brand-new cohort that hasn't lived long enough to reach week w yet
  // would count as "0% retention" at that week instead of "not applicable",
  // dragging the average down for a reason that has nothing to do with
  // actual retention.
  const avgByWeek: number[] = Array.from({ length: cols }, (_, w) => {
    if (w === 0) return 100;
    const v = data.rows.filter(r => r.totalUsers > 0 && w < weeksElapsed(r.cohortWeek));
    if (!v.length) return 0;
    return Math.round(v.reduce((s, r) => s + pct(r.retained[w], r.totalUsers), 0) / v.length);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-separate border-spacing-1 min-w-[600px]">
        <thead>
          <tr>
            <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1 w-24" title="Users grouped by the week they first fired the qualifying event">Cohort</th>
            <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1 w-16" title="Total unique users in that cohort">Users</th>
            {Array.from({ length: cols }, (_, w) => (
              <th
                key={w}
                className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 py-1 min-w-[52px]"
                title={w === 0
                  ? "The week each cohort's users first fired the qualifying event — always 100%, by definition"
                  : `% of each cohort who fired ${qualifyingEvent} again, ${w} week${w > 1 ? "s" : ""} after their first time`}
              >
                {w === 0 ? "Wk 0" : `Wk ${w}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1 text-[11px] font-bold text-gray-500" title="Blended across cohorts old enough to have reached that week — newer cohorts that haven't lived that long yet are left out, not counted as 0%">Average</td>
            <td className="px-2 py-1 text-right text-[11px] text-gray-400">—</td>
            {avgByWeek.map((avg, w) => (
              <td key={w} className="px-1 py-1">
                <div
                  className={`rounded-lg px-1 py-1.5 text-center font-bold text-[11px] ${heatColor(avg, w === 0)}`}
                  title={w === 0
                    ? "Always 100% — every cohort starts at its own first week"
                    : avg > 0
                      ? `On average, ${avg}% of users came back and fired ${qualifyingEvent} again ${w} week${w > 1 ? "s" : ""} after their first time`
                      : "No cohort has reached this week yet"}
                >
                  {avg > 0 ? `${avg}%` : "—"}
                </div>
              </td>
            ))}
          </tr>
          <tr><td colSpan={cols + 2}><div className="h-px bg-gray-100 my-1" /></td></tr>
          {data.rows.map(row => (
            <tr key={row.cohortWeek}>
              <td
                className="px-2 py-1 font-medium text-gray-700 whitespace-nowrap"
                title={`${row.totalUsers.toLocaleString()} users whose first ${qualifyingEvent} happened during the week of ${fmtWeek(row.cohortWeek)}`}
              >
                {fmtWeek(row.cohortWeek)}
              </td>
              <td className="px-2 py-1 text-right font-mono text-gray-500">{row.totalUsers.toLocaleString()}</td>
              {Array.from({ length: cols }, (_, w) => {
                const n = row.retained[w] ?? 0;
                const p = w === 0 ? 100 : pct(n, row.totalUsers);
                // "Hasn't happened yet for this cohort" (blank) vs "happened
                // and was genuinely 0%" (shown as 0%, not blank) — these
                // used to look identical, which is exactly what made a real
                // 0% retention week indistinguishable from missing data.
                const noData = w > 0 && w >= weeksElapsed(row.cohortWeek);
                return (
                  <td key={w} className="px-1 py-1">
                    <div
                      className={`rounded-lg px-1 py-1.5 text-center text-[11px] font-semibold ${noData ? "bg-gray-50 text-gray-200" : heatColor(p, w === 0)}`}
                      title={noData
                        ? "Future week — hasn't happened yet for this cohort"
                        : w === 0
                          ? `${row.totalUsers.toLocaleString()} users — this is the week they first fired ${qualifyingEvent}`
                          : `${n.toLocaleString()} of ${row.totalUsers.toLocaleString()} users (${p}%) fired ${qualifyingEvent} again in week ${w}`}
                    >
                      {noData ? "" : w === 0 ? "100%" : `${p}%`}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] text-gray-400">Scale:</span>
        {[
          { label: "0%", cls: "bg-gray-100" },
          { label: "<10%", cls: "bg-red-100" },
          { label: "10–40%", cls: "bg-amber-100" },
          { label: "40–60%", cls: "bg-lime-100" },
          { label: "60–80%", cls: "bg-emerald-100" },
          { label: ">80%", cls: "bg-emerald-500" },
        ].map(({ label, cls }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3.5 h-3.5 rounded ${cls}`} />
            <span className="text-[10px] text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AI Insight ───────────────────────────────────────────────────────────────

// The AI is prompted in plain English, not told to avoid markdown, so it
// reaches for **bold** to emphasize the key clause of a bullet — which then
// rendered as literal asterisks since this panel only ever printed raw
// strings. Parsing just this one inline pattern (no need for a full markdown
// renderer here) turns it back into actual emphasis.
function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  );
}

function InsightPanel({ data, weeks, eventName, totalUsers, orgId }: { data: CohortData; weeks: number; eventName: string; totalUsers: number; orgId: string }) {
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(false);
  const ran = useRef(false);

  async function generate() {
    if (loading || !data.rows.length) return;
    setLoading(true);
    ran.current = true;
    const text = await getCohortInsight(data, { weeks, eventName: eventName || undefined, totalUsers });
    setInsight(text);
    setLoading(false);
  }

  useEffect(() => {
    if (!ran.current && data.rows.length > 0) generate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data.rows.length) return null;

  // The AI is asked for 3 bullets, each starting with "•" — strip that since
  // it's rendered as a proper numbered item below instead of a literal
  // character in the text.
  const points = insight.split("\n").map(l => l.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <Sparkles size={12} className="text-indigo-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">AI Insight</span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && points.length > 0 && (
            <SaveInsightButton
              orgId={orgId}
              source="cohort"
              content={points.map((p, i) => `${i + 1}. ${p.replace(/\*\*/g, "")}`).join("\n")}
              context={`Cohort retention — ${eventName || "all events"}, ${weeks} weeks`}
            />
          )}
          <button onClick={generate} disabled={loading} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 disabled:opacity-40 transition-colors">
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {loading ? "Analyzing…" : "Refresh"}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-gray-100 animate-pulse rounded" style={{ width: `${85 - i * 12}%` }} />)}</div>
      ) : points.length > 0 ? (
        <div className="space-y-3">
          {points.map((line, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 text-[11px] font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-gray-700 leading-relaxed">{renderInlineBold(line)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Two-step conversion card ─────────────────────────────────────────────────
// Answers the actual two-step question directly ("of users who did A, what %
// also did B within N days") instead of forcing it through the weekly
// retention table, which answers a different question (return visits over
// calendar weeks) and was the source of the "doesn't correlate" confusion.

function ConversionCard({ orgId, filter }: { orgId: string; filter: CohortFilter }) {
  const [result, setResult] = useState<CohortConversionResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCohortConversion(orgId, filter).then(r => {
      if (!cancelled) { setResult(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [orgId, filter]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="h-4 w-40 bg-gray-100 animate-pulse rounded mb-4" />
        <div className="h-10 w-24 bg-gray-100 animate-pulse rounded" />
      </div>
    );
  }
  if (!result) return null;

  if (result.error) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-2xl px-4 py-3">
        {result.error}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Zap size={12} className="text-indigo-600" />
        </div>
        <p className="text-sm font-semibold text-gray-800">Conversion</p>
      </div>
      <p className="text-xs text-gray-400 mb-4 ml-8">
        Of users who fired <code className="font-mono bg-gray-100 px-1 rounded">{result.eventName}</code>, % who also fired{" "}
        <code className="font-mono bg-gray-100 px-1 rounded">{result.secondEventName}</code> within {result.withinDays} day{result.withinDays > 1 ? "s" : ""} (same user, last 90 days).
      </p>
      <div className="flex items-end gap-6 ml-8">
        <div>
          <p className="text-4xl font-bold text-indigo-600">{result.convertedPct}%</p>
          <p className="text-xs text-gray-400 mt-1">converted</p>
        </div>
        <div className="text-sm text-gray-500 pb-1">
          out of <span className="font-semibold text-gray-700">{result.firstEventUsers.toLocaleString()}</span> users who fired{" "}
          <code className="font-mono text-xs">{result.eventName}</code>
        </div>
      </div>
    </div>
  );
}

// ─── Weekly active users ──────────────────────────────────────────────────────

function WeeklyActiveTab({ data }: { data: WAURow[] }) {
  if (!data.length) return <EmptyState tab="active" />;
  const maxUsers = Math.max(...data.map(r => r.users), 1);
  const maxEvents = Math.max(...data.map(r => r.events), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "This week WAU", value: (data.at(-1)?.users ?? 0).toLocaleString() },
          { label: "Peak WAU",      value: Math.max(...data.map(r => r.users)).toLocaleString() },
          { label: "Total events",  value: data.reduce((s, r) => s + r.events, 0).toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Weekly active users</p>
        <div className="flex items-end gap-1.5 h-36">
          {data.map(row => {
            const h = Math.max(4, Math.round((row.users / maxUsers) * 100));
            return (
              <div key={row.week} className="flex-1 group min-w-0 relative">
                <div className="w-full bg-indigo-500 hover:bg-indigo-600 rounded-t transition-colors" style={{ height: `${h}%`, minHeight: 4 }} title={`${fmtWeek(row.week)}: ${row.users.toLocaleString()} users`} />
                <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap pointer-events-none z-10">
                  {fmtWeek(row.week)}: {row.users.toLocaleString()} users
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-[10px] text-gray-400">{fmtWeek(data[0].week)}</span>
          <span className="text-[10px] text-gray-400">{fmtWeek(data.at(-1)!.week)}</span>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Event volume</p>
        <div className="flex items-end gap-1.5 h-28">
          {data.map(row => {
            const h = Math.max(2, Math.round((row.events / maxEvents) * 100));
            return (
              <div key={row.week} className="flex-1 min-w-0">
                <div className="w-full bg-violet-400 hover:bg-violet-500 rounded-t transition-colors" style={{ height: `${h}%`, minHeight: 2 }} title={`${fmtWeek(row.week)}: ${row.events.toLocaleString()}`} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Week</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Active users</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Events</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg/user</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {[...data].reverse().map(row => (
              <tr key={row.week} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-700">{fmtWeek(row.week)}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{row.users.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{row.events.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-400">{row.users ? (row.events / row.users).toFixed(1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Top events ───────────────────────────────────────────────────────────────

function TopEventsTab({ data }: { data: TopEventRow[] }) {
  if (!data.length) return <EmptyState tab="events" />;
  const maxCount = Math.max(...data.map(r => r.count), 1);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Top events — last 30 days</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Event</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Count</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Users</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider w-40">Volume</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {data.map((row, i) => (
            <tr key={row.name} className="hover:bg-gray-50/50">
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-300 font-mono w-4">{i + 1}</span>
                  <code className="text-xs font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{row.name}</code>
                </div>
              </td>
              <td className="px-5 py-3 text-right font-mono text-gray-700 font-medium">{row.count.toLocaleString()}</td>
              <td className="px-5 py-3 text-right font-mono text-gray-500">{row.users.toLocaleString()}</td>
              <td className="px-5 py-3">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.round((row.count / maxCount) * 100)}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "retention" | "active" | "events";

export default function CohortsPage() {
  const { currentOrg } = useOrg();
  const [flagChecked, setFlagChecked] = useState(true);
  const [locked, setLocked] = useState(false);
  const [tab, setTab]     = useState<Tab>("retention");
  const [weeks, setWeeks] = useState(8);
  const [eventName, setEventName] = useState("");
  const [loading, setLoading]     = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  // Set while editing an existing filter (vs. building a brand-new one) so
  // the modal opens pre-filled instead of blank.
  const [editingFilter, setEditingFilter] = useState<CohortFilter | null>(null);
  const [activeFilter, setActiveFilter] = useState<CohortFilter | null>(null);
  const [activeCohortId, setActiveCohortId] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const [savedCohorts, setSavedCohorts] = useState<SavedCohort[]>([]);

  // Picking an event here (via the builder, a saved cohort, or the plain
  // dropdown) only ever searched Mixpanel for the NAME — syncMixpanelEventNames
  // populates the autocomplete list but never pulls the actual per-user rows.
  // Retention/conversion math below reads only from our own `events` table,
  // so an event that's never been wired to a goal's tracked feature (the only
  // other place a Mixpanel sync runs) would show "no users" here even though
  // Mixpanel itself has plenty of occurrences. Pulling the specific event(s)
  // a cohort filter actually needs, right when it's applied, fixes that at
  // the source instead of just explaining the gap in an error message.
  const [syncingFilter, setSyncingFilter] = useState(false);
  // Surfaced instead of swallowed — if the sync itself can't pull raw
  // events (wrong credentials, a Mixpanel plan that doesn't include raw
  // export, etc.) the "no users fired this event" message below would
  // otherwise look identical to "this just hasn't been synced yet", and
  // there'd be no way to tell which one is actually happening.
  const [syncError, setSyncError] = useState<string | null>(null);

  async function ensureEventsSynced(filter: CohortFilter) {
    if (!currentOrg) return;
    const names = [filter.eventName, filter.secondEventName].filter((n): n is string => !!n);
    if (!names.length) return;
    setSyncError(null);
    const { connected } = await getMixpanelSettings(currentOrg.id);
    if (!connected) return;
    setSyncingFilter(true);
    const result = await syncMixpanelRawEvents(currentOrg.id, names, 90).catch((e) => ({ synced: 0, error: (e as Error).message }));
    setSyncingFilter(false);
    if (result.error) setSyncError(result.error);
  }

  const [cohortData, setCohortData] = useState<CohortData>({ rows: [], maxWeeks: 0 });
  const [wauData, setWauData]       = useState<WAURow[]>([]);
  const [topEvents, setTopEvents]   = useState<TopEventRow[]>([]);
  const [eventNames, setEventNames] = useState<EventNameWithSource[]>([]);
  const [dataInfo, setDataInfo]     = useState<CohortDataInfo | null>(null);

  const retentionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentOrg) setSavedCohorts(loadSaved(currentOrg.id));
  }, [currentOrg]);

  const load = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    const filterEvent = activeFilter?.eventName ?? (eventName || undefined);
    const [cohort, wau, top, info] = await Promise.all([
      getCohortRetention(currentOrg.id, { weeks, eventName: filterEvent }),
      getWeeklyActiveUsers(currentOrg.id, weeks),
      getTopEvents(currentOrg.id),
      getCohortDataInfo(currentOrg.id, weeks),
    ]);
    // Load event names independently — don't let it block main data
    getEventNamesWithSource(currentOrg.id)
      .then(names => {
        if (names.length > 0) { setEventNames(names); return; }
        return getDistinctEventNames(currentOrg.id)
          .then(ns => setEventNames(ns.map(n => ({ name: n, source: null }))));
      })
      .catch(() =>
        getDistinctEventNames(currentOrg.id)
          .then(ns => setEventNames(ns.map(n => ({ name: n, source: null }))))
          .catch(() => {})
      );
    setCohortData(cohort);
    setWauData(wau);
    setTopEvents(top);
    setDataInfo(info);
    setLoading(false);
  }, [currentOrg, weeks, eventName, activeFilter]);

  useEffect(() => { load(); }, [load]);

  if (!currentOrg) return null;
  if (!flagChecked) return null;
  if (locked) return <LockedFeature name="Cohorts" />;

  async function applyFilter(filter: CohortFilter) {
    setShowBuilder(false);
    await ensureEventsSynced(filter);
    setActiveFilter(filter);
    setEventName(filter.eventName ?? "");
    setTab("retention");

    // If this was an edit of an already-saved cohort, patch its stored filter
    // in place instead of treating it as a brand-new unsaved one — otherwise
    // "fix the event this cohort points at" would silently lose the save.
    if (editingFilter && activeCohortId && currentOrg) {
      const updated = savedCohorts.map(c => c.id === activeCohortId ? { ...c, filter } : c);
      setSavedCohorts(updated);
      persistSaved(currentOrg.id, updated);
      setEditingFilter(null);
    } else {
      setActiveCohortId(null);
      setEditingFilter(null);
      setPendingSave(true);
    }
    setTimeout(() => retentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }

  function openEditFilter() {
    if (!activeFilter) return;
    setEditingFilter(activeFilter);
    setShowBuilder(true);
  }

  function saveCohort(name: string) {
    if (!activeFilter || !currentOrg) return;
    const c: SavedCohort = { id: crypto.randomUUID(), name, filter: activeFilter, createdAt: new Date().toISOString() };
    const updated = [...savedCohorts, c];
    setSavedCohorts(updated);
    persistSaved(currentOrg.id, updated);
    setActiveCohortId(c.id);
    setPendingSave(false);
  }

  async function selectSavedCohort(c: SavedCohort) {
    await ensureEventsSynced(c.filter);
    setActiveFilter(c.filter);
    setActiveCohortId(c.id);
    setEventName(c.filter.eventName ?? "");
    setTab("retention");
    setTimeout(() => retentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }

  function deleteSavedCohort(id: string) {
    if (!currentOrg) return;
    const updated = savedCohorts.filter(c => c.id !== id);
    setSavedCohorts(updated);
    persistSaved(currentOrg.id, updated);
    if (activeCohortId === id) { setActiveCohortId(null); setActiveFilter(null); setEventName(""); }
  }

  function clearFilter() {
    setActiveFilter(null);
    setActiveCohortId(null);
    setEditingFilter(null);
    setEventName("");
    setPendingSave(false);
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "retention", label: "Retention",    icon: Users },
    { id: "active",    label: "Active users", icon: TrendingUp },
    { id: "events",    label: "Top events",   icon: Zap },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users size={20} className="text-indigo-500" /> Cohorts
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Weekly retention, active users, and top events.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} className="appearance-none bg-white border border-gray-200 text-sm text-gray-700 rounded-xl pl-3 pr-8 py-2 focus:outline-none cursor-pointer">
              {[4, 8, 12, 16].map(w => <option key={w} value={w}>Last {w} weeks</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {tab === "retention" && !activeFilter && eventNames.length > 0 && (
            <EventFilterDropdown
              value={eventName}
              events={eventNames}
              onChange={async (name) => { await ensureEventsSynced({ eventName: name || null }); setEventName(name); }}
            />
          )}

          <button
            onClick={() => setShowBuilder(true)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          >
            <Plus size={14} /> Build cohort
          </button>

          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 bg-white border border-gray-200 px-3 py-2 rounded-xl transition-colors disabled:opacity-40">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── Data window ──────────────────────────────────────────────────────── */}
      {syncingFilter && (
        <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
          <RefreshCw size={12} className="animate-spin" /> Pulling the latest occurrences of this event from Mixpanel…
        </div>
      )}
      {syncError && !syncingFilter && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          Couldn&apos;t pull fresh Mixpanel data for this event: {syncError}
        </div>
      )}
      <DataInfoBar info={dataInfo} loading={loading} />

      {/* ── Saved cohorts strip ──────────────────────────────────────────────── */}
      <SavedCohortsStrip
        cohorts={savedCohorts}
        activeCohortId={activeCohortId}
        onSelect={selectSavedCohort}
        onDelete={deleteSavedCohort}
      />

      {/* ── Active filter pill ───────────────────────────────────────────────── */}
      {activeFilter && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium rounded-xl px-3 py-2">
          <Filter size={11} className="flex-shrink-0" />
          <span className="flex-1">{activeFilter.description}</span>
          <button onClick={openEditFilter} className="hover:text-indigo-900 flex-shrink-0" title="Edit this cohort's event(s)">
            <Pencil size={12} />
          </button>
          <button onClick={clearFilter} className="hover:text-indigo-900 flex-shrink-0" title="Clear filter"><X size={12} /></button>
        </div>
      )}

      {/* ── Two-step conversion (only when this cohort is an A-then-B condition) ── */}
      {activeFilter?.eventName && activeFilter?.secondEventName && (
        <ConversionCard orgId={currentOrg.id} filter={activeFilter} />
      )}

      {/* ── Tabs + content ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div ref={retentionRef} className="bg-white border border-gray-100 rounded-2xl p-6">
        {loading ? (
          <div className="space-y-3 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 bg-gray-100 animate-pulse rounded-lg" style={{ opacity: 1 - i * 0.15 }} />
            ))}
          </div>
        ) : (
          <>
            {tab === "retention" && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Weekly cohort retention</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                    Each row is a group of users, sorted by the week they first fired{" "}
                    <code className="font-mono bg-gray-50 px-1 rounded">{activeFilter?.eventName || eventName || "any event"}</code>.
                    Wk 0 is always 100% — it's that first week, by definition. Every column after it shows what % of that
                    same group came back and fired it again, that many weeks later. Hover any cell for the exact numbers.
                    {activeFilter ? <span className="block mt-1 text-indigo-500">{activeFilter.description}</span> : null}
                  </p>
                  {activeFilter?.secondEventName && (
                    <p className="text-[11px] text-gray-400 mt-1">
                      This is general week-over-week return activity for users who fired the first event — a different question from the conversion % above, which checks the specific A-then-B condition per user.
                    </p>
                  )}
                </div>
                <RetentionGrid data={cohortData} qualifyingEvent={activeFilter?.eventName || eventName || "the qualifying event"} />
              </div>
            )}
            {tab === "active" && <WeeklyActiveTab data={wauData} />}
            {tab === "events" && <TopEventsTab data={topEvents} />}
          </>
        )}
      </div>

      {/* ── AI Insight ───────────────────────────────────────────────────────── */}
      {tab === "retention" && !loading && (
        <InsightPanel data={cohortData} weeks={weeks} eventName={activeFilter?.eventName ?? eventName} totalUsers={dataInfo?.totalUsers ?? 0} orgId={currentOrg?.id ?? ""} />
      )}

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {showBuilder && (
        <CohortBuilderModal
          orgId={currentOrg.id}
          initialFilter={editingFilter}
          onApply={applyFilter}
          onClose={() => { setShowBuilder(false); setEditingFilter(null); }}
        />
      )}

      {pendingSave && activeFilter && (
        <SaveNameDialog
          filter={activeFilter}
          onSave={saveCohort}
          onSkip={() => setPendingSave(false)}
        />
      )}
    </div>
  );
}
