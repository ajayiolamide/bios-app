"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search, RefreshCw, ChevronDown, Zap, Trash2, X,
  AlertTriangle, Check,
} from "lucide-react";
import {
  getEvents,
  deleteEventsByIds,
  deleteAllEvents,
  deleteEventsByName,
  deleteEventsBySource,
} from "@/app/actions/events";
import type { Event } from "@/types/database";

const PAGE_SIZE = 50;

const COLOURS = [
  "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "bg-violet-500/15 text-violet-600 border-violet-500/20",
  "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "bg-rose-500/15 text-rose-600 border-rose-500/20",
  "bg-cyan-500/15 text-cyan-600 border-cyan-500/20",
];
function eventColour(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLOURS[h % COLOURS.length];
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  loading,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={16} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-0.5">Are you sure?</p>
            <p className="text-sm text-gray-500">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition-colors border border-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {loading && <RefreshCw size={12} className="animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Event Stream ─────────────────────────────────────────────────────────────

interface Props {
  orgId: string;
  refreshKey: number;
}

export function EventStream({ orgId, refreshKey }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Source filter
  const [source, setSource] = useState<"all" | "csv" | "mixpanel">("all");

  // Delete state
  const [confirm, setConfirm] = useState<null | "selected" | "all" | { name: string } | { source: "csv" | "mixpanel" }>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const fetchEvents = useCallback(
    async (reset = false) => {
      if (reset) {
        offsetRef.current = 0;
        setLoading(true);
        setSelected(new Set());
      } else {
        setLoadingMore(true);
      }

      const currentOffset = offsetRef.current;

      const { events: data, total: count } = await getEvents(orgId, {
        search,
        offset: currentOffset,
        limit: PAGE_SIZE,
        source: source === "all" ? undefined : source,
      });

      offsetRef.current = currentOffset + PAGE_SIZE;
      setEvents(reset ? data : (prev) => {
        // Deduplicate by id in case of concurrent calls
        const existingIds = new Set(prev.map((e) => e.id));
        return [...prev, ...data.filter((e) => !existingIds.has(e.id))];
      });
      setTotal(count);

      setLoading(false);
      setLoadingMore(false);
    },
    [orgId, search, source]
  );

  useEffect(() => {
    fetchEvents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, search, source, refreshKey]);

  // ── Selection helpers
  const allPageSelected = events.length > 0 && events.every((e) => selected.has(e.id));
  function toggleAll() {
    if (allPageSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(events.map((e) => e.id)));
    }
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Delete handlers
  async function execDelete() {
    if (!confirm) return;
    setDeleting(true);
    let result: { deleted: number; error?: string };

    if (confirm === "all") {
      result = await deleteAllEvents(orgId);
    } else if (confirm === "selected") {
      result = await deleteEventsByIds(orgId, [...selected]);
    } else if ("source" in confirm) {
      result = await deleteEventsBySource(orgId, confirm.source);
    } else {
      result = await deleteEventsByName(orgId, confirm.name);
    }

    setDeleting(false);
    setConfirm(null);

    if (result.error) {
      setDeleteMsg(`Error: ${result.error}`);
    } else {
      setDeleteMsg(`Deleted ${result.deleted.toLocaleString()} event${result.deleted !== 1 ? "s" : ""}.`);
      setSelected(new Set());
      fetchEvents(true);
    }

    // Clear message after 4s
    setTimeout(() => setDeleteMsg(null), 4000);
  }

  function confirmMsg() {
    if (!confirm) return "";
    if (confirm === "all") return `This will permanently delete all ${total.toLocaleString()} events for this workspace.`;
    if (confirm === "selected") return `This will permanently delete ${selected.size} selected event${selected.size !== 1 ? "s" : ""}.`;
    if ("source" in confirm) return `This will permanently delete all ${confirm.source === "mixpanel" ? "Mixpanel-synced" : "CSV-imported"} events.`;
    return `This will permanently delete all events named "${confirm.name}".`;
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          message={confirmMsg()}
          onConfirm={execDelete}
          onCancel={() => setConfirm(null)}
          loading={deleting}
        />
      )}

      <div className="space-y-4">
        {/* Source filter tabs */}
        <div className="flex items-center gap-1 bg-muted/40 border rounded-lg p-1 w-fit">
          {(["all", "csv", "mixpanel"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${source === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s === "all" ? "All" : s === "csv" ? "📄 CSV" : "📊 Mixpanel"}
            </button>
          ))}
        </div>

        {/* Search + actions bar */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by event name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchEvents(true)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {total > 0 && source !== "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm({ source })}
              className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete {source === "csv" ? "CSV" : "Mixpanel"} events
            </Button>
          )}
          {total > 0 && source === "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm("all")}
              className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete all
            </Button>
          )}
        </div>

        {/* Selection action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border border-indigo-100 rounded-xl">
            <Check size={14} className="text-indigo-500" />
            <p className="text-sm text-indigo-700 font-medium flex-1">
              {selected.size} event{selected.size !== 1 ? "s" : ""} selected
            </p>
            <button
              onClick={() => setConfirm("selected")}
              className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
            >
              <Trash2 size={13} /> Delete selected
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-indigo-400 hover:text-indigo-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Delete feedback */}
        {deleteMsg && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700">
            <Check size={14} />
            {deleteMsg}
          </div>
        )}

        {/* Count */}
        {total > 0 && (
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} event{total !== 1 ? "s" : ""}
            {search ? ` matching "${search}"` : ""}
          </p>
        )}

        {/* Table */}
        {events.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Zap className="h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium text-muted-foreground">No events yet</p>
              <p className="text-sm text-muted-foreground/70">
                {search ? "No events match that filter." : "Import a CSV or send events via the API to get started."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {/* Select all checkbox */}
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Event</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Properties</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Time</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {events.map((ev) => {
                    const isSelected = selected.has(ev.id);
                    return (
                      <tr
                        key={ev.id}
                        className={`group transition-colors ${isSelected ? "bg-indigo-50/60" : "hover:bg-muted/30"}`}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(ev.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => setConfirm({ name: ev.name })}
                            className="group/badge relative"
                            title={`Delete all "${ev.name}" events`}
                          >
                            <Badge className={`border text-xs font-medium ${eventColour(ev.name)} group-hover/badge:opacity-70 transition-opacity`}>
                              {ev.name}
                            </Badge>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                          {ev.user_id ? (
                            <span title={ev.user_id}>
                              {ev.user_id.length > 16 ? `${ev.user_id.slice(0, 16)}…` : ev.user_id}
                            </span>
                          ) : (
                            <span className="opacity-30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[280px]">
                          {(() => {
                            const props = ev.properties as Record<string, unknown> | null;
                            const source = props?.source as string | undefined;
                            if (source === "mixpanel") {
                              return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100 text-[11px] font-medium">📊 Mixpanel</span>;
                            }
                            if (source === "csv") {
                              return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[11px] font-medium">📄 CSV</span>;
                            }
                            const rest = props ? Object.entries(props).filter(([k]) => k !== "source") : [];
                            if (rest.length === 0) return <span className="opacity-30">—</span>;
                            const str = JSON.stringify(Object.fromEntries(rest));
                            return <span className="font-mono truncate block">{str.slice(0, 80)}{str.length > 80 ? "…" : ""}</span>;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap" title={ev.timestamp}>
                          {relativeTime(ev.timestamp)}
                        </td>
                        {/* Row delete */}
                        <td className="pr-3">
                          <button
                            onClick={() => { setSelected(new Set([ev.id])); setConfirm("selected"); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"
                            title="Delete this event"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {events.length < total && (
              <div className="border-t p-3 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchEvents(false)}
                  disabled={loadingMore}
                  className="text-muted-foreground"
                >
                  {loadingMore ? (
                    <><RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> Loading…</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5 mr-1.5" /> Load more ({total - events.length} remaining)</>
                  )}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
