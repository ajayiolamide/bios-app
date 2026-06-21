"use client";

import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { createMetric, getDistinctEventNames } from "@/app/actions/metrics";
import { getMixpanelSettings, syncMixpanelEventNames } from "@/app/actions/mixpanel";

interface Props {
  orgId: string;
  onCreated: () => void;
  onClose: () => void;
}

const AGGREGATIONS = [
  { value: "count", label: "Event count" },
  { value: "unique_users", label: "Unique users" },
  { value: "unique_sessions", label: "Unique sessions" },
];

export function CreateMetricDialog({ orgId, onCreated, onClose }: Props) {
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventName, setEventName] = useState("");
  const [aggregation, setAggregation] = useState("count");

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setSyncing(true);
      const { connected } = await getMixpanelSettings(orgId);
      if (connected && !cancelled) {
        await syncMixpanelEventNames(orgId).catch(() => {});
      }
      if (!cancelled) {
        const names = await getDistinctEventNames(orgId);
        setEventNames(names);
        setSyncing(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [orgId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !eventName.trim()) return;
    setLoading(true);
    setError(null);
    const { error } = await createMetric(orgId, { name, description, event_name: eventName, aggregation });
    setLoading(false);
    if (error) { setError(error); return; }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-lg">New metric</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Metric name</label>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Daily active users"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="What does this metric track?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Event name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Event</label>
              {syncing && (
                <span className="flex items-center gap-1 text-[11px] text-gray-400">
                  <Loader2 size={10} className="animate-spin" /> Syncing events…
                </span>
              )}
              {!syncing && eventNames.length > 0 && (
                <span className="text-[11px] text-gray-400">{eventNames.length} events available</span>
              )}
            </div>
            {eventNames.length > 0 ? (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                required
              >
                <option value="">Select an event…</option>
                {eventNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. page_view"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                required
              />
            )}
          </div>

          {/* Aggregation */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Aggregation</label>
            <div className="flex gap-2 flex-wrap">
              {AGGREGATIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAggregation(a.value)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    aggregation === a.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 hover:bg-muted border-transparent"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md text-sm border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create metric"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
