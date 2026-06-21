"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOrg } from "@/contexts/org-context";
import { createOrganizationAndReturn, removeOrganization } from "@/app/actions/organizations";
import { ChevronsUpDown, Building2, Check, Plus, Trash2, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function OrgSwitcher() {
  const { organizations, currentOrg, setCurrentOrg, addOrg, removeOrg } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setNewName("");
        setError("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (adding) setTimeout(() => inputRef.current?.focus(), 50);
  }, [adding]);

  function handleAdd() {
    if (!newName.trim()) return;
    setError("");
    startTransition(async () => {
      const { org, error: err } = await createOrganizationAndReturn(newName.trim());
      if (err) { setError(err); return; }
      if (org) {
        addOrg(org);
        setAdding(false);
        setNewName("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function handleRemove(orgId: string, orgName: string) {
    if (!confirm(`Remove "${orgName}"? If you're the owner, all data will be deleted.`)) return;
    setRemovingId(orgId);
    startTransition(async () => {
      const { error: err } = await removeOrganization(orgId);
      setRemovingId(null);
      if (err) { alert(err); return; }
      const next = removeOrg(orgId);
      setOpen(false);
      if (!next) router.push("/create-workspace");
      else router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => { setOpen(!open); setAdding(false); setError(""); }}
        className="w-full flex items-center justify-between gap-2 px-2 h-10 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-600">
            <Building2 className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="truncate text-sm font-medium">
            {currentOrg?.name ?? "No organization"}
          </span>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border border-slate-700 bg-slate-800 shadow-xl overflow-hidden">
          <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Companies
          </p>

          {/* Org list */}
          <div className="max-h-48 overflow-y-auto">
            {organizations.map((org) => (
              <div
                key={org.id}
                className="group flex items-center gap-2 px-3 py-2 hover:bg-slate-700 cursor-pointer transition-colors"
                onClick={() => { setCurrentOrg(org); setOpen(false); }}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-600">
                  <Building2 className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="flex-1 truncate text-sm text-slate-100">{org.name}</span>
                <Check className={cn("h-3.5 w-3.5 text-indigo-400 flex-shrink-0", currentOrg?.id === org.id ? "opacity-100" : "opacity-0")} />
                {/* Remove button — only show on hover, don't trigger row click */}
                {removingId === org.id ? (
                  <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin flex-shrink-0" />
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(org.id, org.name); }}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-slate-500 hover:text-red-400 transition-all"
                    title="Remove company"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-700">
            {adding ? (
              <div className="p-2 space-y-1.5">
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
                  placeholder="Company name…"
                  className="w-full bg-slate-700 text-slate-100 placeholder-slate-500 text-sm rounded px-2.5 py-1.5 outline-none border border-slate-600 focus:border-indigo-500"
                />
                {error && <p className="text-[11px] text-red-400 px-0.5">{error}</p>}
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAdd}
                    disabled={isPending || !newName.trim()}
                    className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded py-1.5 transition-colors"
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Add
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(""); setError(""); }}
                    className="px-2 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add company
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
