"use client";

import { useState, useEffect } from "react";
import { useOrg } from "@/contexts/org-context";
import { EventStream } from "@/components/events/event-stream";
import { CsvImport } from "@/components/events/csv-import";
import { cn } from "@/lib/utils";
import { Zap, Upload, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { getMixpanelSettings, syncMixpanelEventNames } from "@/app/actions/mixpanel";

type Tab = "stream" | "import";
type SyncState = "idle" | "syncing" | "done" | "error";

export default function EventsPage() {
  const { currentOrg } = useOrg();
  const [tab, setTab] = useState<Tab>("stream");
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [mpConnected, setMpConnected] = useState(false);

  // Just check connection status here — syncing automatically on every visit
  // to this page duplicated the explicit "Sync Event Names" action on the
  // Sources page and fired a Mixpanel API call silently on every page load.
  // The manual "Re-sync" button below covers the same need on purpose.
  useEffect(() => {
    if (!currentOrg) return;
    getMixpanelSettings(currentOrg.id).then(({ connected }) => setMpConnected(connected));
  }, [currentOrg]);

  if (!currentOrg) return null;

  function handleImported() {
    setTab("stream");
    setRefreshKey((k) => k + 1);
  }

  async function handleManualSync() {
    if (!currentOrg || syncState === "syncing") return;
    setSyncState("syncing");
    setSyncMsg(null);
    const result = await syncMixpanelEventNames(currentOrg.id);
    if (result.error) {
      setSyncState("error");
      setSyncMsg(result.error);
    } else {
      setSyncState("done");
      setSyncMsg(`Synced ${result.synced} new event${result.synced !== 1 ? "s" : ""} from Mixpanel (${result.total} total)`);
      if (result.synced > 0) setRefreshKey(k => k + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Raw event stream · import via CSV or the SDK
        </p>
        {mpConnected && (
          <div className="flex items-center gap-2">
            {syncState === "syncing" && (
              <span className="flex items-center gap-1.5 text-xs text-indigo-600">
                <RefreshCw size={12} className="animate-spin" /> Syncing Mixpanel events…
              </span>
            )}
            {syncState === "done" && syncMsg && (
              <span className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 size={12} /> {syncMsg}
              </span>
            )}
            {syncState === "error" && (
              <span className="flex items-center gap-1.5 text-xs text-red-500" title={syncMsg ?? undefined}>
                <AlertCircle size={12} /> Mixpanel sync failed
              </span>
            )}
            <button
              onClick={handleManualSync}
              disabled={syncState === "syncing"}
              title="Same action as 'Sync Event Names' on the Sources page"
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 disabled:opacity-40 transition-colors border border-gray-200 rounded-lg px-2.5 py-1"
            >
              <RefreshCw size={11} className={syncState === "syncing" ? "animate-spin" : ""} />
              Sync Event Names
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {(
          [
            { id: "stream", label: "Event stream", icon: Zap },
            { id: "import", label: "Import CSV", icon: Upload },
          ] as { id: Tab; label: string; icon: React.ElementType }[]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "stream" && (
        <EventStream orgId={currentOrg.id} refreshKey={refreshKey} />
      )}
      {tab === "import" && (
        <CsvImport orgId={currentOrg.id} onImported={handleImported} />
      )}
    </div>
  );
}
