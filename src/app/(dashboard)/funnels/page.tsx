"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Filter } from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import { getFunnels } from "@/app/actions/funnels";
import type { Funnel } from "@/types/database";
import { FunnelCard } from "@/components/funnels/funnel-card";
import { CreateFunnelDialog } from "@/components/funnels/create-funnel-dialog";
import { PageLoader } from "@/components/ui/page-loader";

export default function FunnelsPage() {
  const { currentOrg } = useOrg();
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    const data = await getFunnels(currentOrg.id);
    setFunnels(data);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!currentOrg || loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Journeys</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Map conversion and drop-off across every step your users take
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New funnel
        </button>
      </div>

      {/* List */}
      {funnels.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-muted/20 py-20 text-center">
          <Filter className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">No funnels yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Define a sequence of events to measure conversion.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create funnel
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {funnels.map((f) => (
            <FunnelCard key={f.id} funnel={f} orgId={currentOrg.id} onDeleted={refresh} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateFunnelDialog
          orgId={currentOrg.id}
          onCreated={() => { setShowCreate(false); refresh(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
