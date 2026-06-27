"use client";

import { useState, useTransition } from "react";
import { banUser, unbanUser, deleteUser, setOrgFlag, type AdminUser, type OrgFlagKey } from "@/app/actions/admin";
import { Loader2, ShieldOff, ShieldCheck, Trash2, ExternalLink, Sparkles, FileText, BarChart3 } from "lucide-react";

const FLAG_META: { key: OrgFlagKey; label: string; icon: React.ElementType; color: string }[] = [
  { key: "ai_enabled",       label: "AI",      icon: Sparkles,  color: "indigo" },
  { key: "reports_enabled",  label: "Reports", icon: FileText,  color: "teal"   },
  { key: "cohorts_enabled",  label: "Cohorts", icon: BarChart3, color: "blue"   },
];

function FlagToggle({ orgId, flagKey, label, icon: Icon, color, enabled }: {
  orgId: string; flagKey: OrgFlagKey; label: string; icon: React.ElementType; color: string; enabled: boolean;
}) {
  const [value, setValue] = useState(enabled);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !value;
    setValue(next);
    startTransition(async () => {
      try { await setOrgFlag(orgId, flagKey, next); }
      catch { setValue(!next); } // revert on error
    });
  }

  const on = `text-${color}-700 bg-${color}-50 border-${color}-200`;
  const off = "text-gray-400 bg-gray-50 border-gray-200";

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      title={`${label}: ${value ? "ON — click to disable" : "OFF — click to enable"}`}
      className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-all ${value ? on : off} ${isPending ? "opacity-50" : "hover:opacity-80"}`}
    >
      {isPending ? <Loader2 size={9} className="animate-spin" /> : <Icon size={9} />}
      {label}
    </button>
  );
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}

function UserRow({ user }: { user: AdminUser }) {
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleBan() {
    startTransition(async () => { await banUser(user.id); });
  }

  function handleUnban() {
    startTransition(async () => { await unbanUser(user.id); });
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return; }
    startTransition(async () => { await deleteUser(user.id); setConfirmDelete(false); });
  }

  return (
    <tr className={`border-t border-gray-50 hover:bg-gray-50/50 transition-colors ${user.banned ? "opacity-60" : ""}`}>
      {/* Email */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-indigo-600">
            {(user.email[0] ?? "?").toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800 truncate max-w-[200px]">{user.email}</p>
            {user.banned && (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">banned</span>
            )}
          </div>
        </div>
      </td>

      {/* Workspace */}
      <td className="px-5 py-3.5">
        {user.org_name ? (
          <p className="text-sm text-gray-700 truncate max-w-[160px]">{user.org_name}</p>
        ) : (
          <span className="text-xs text-gray-300 italic">no workspace</span>
        )}
      </td>

      {/* Joined */}
      <td className="px-5 py-3.5">
        <p className="text-xs text-gray-500">{user.created_at ? new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</p>
      </td>

      {/* Last active */}
      <td className="px-5 py-3.5">
        <p className="text-xs text-gray-500">{timeAgo(user.last_sign_in)}</p>
      </td>

      {/* Usage */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span title="Events">{user.events.toLocaleString()} ev</span>
          <span title="Features">{user.features} feat</span>
          <span title="Reports">{user.reports} rep</span>
        </div>
      </td>

      {/* Feature flags */}
      <td className="px-5 py-3.5">
        {user.org_id ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {FLAG_META.map(f => (
              <FlagToggle
                key={f.key}
                orgId={user.org_id!}
                flagKey={f.key}
                label={f.label}
                icon={f.icon}
                color={f.color}
                enabled={user.feature_flags[f.key]}
              />
            ))}
          </div>
        ) : (
          <span className="text-xs text-gray-300 italic">no workspace</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-1.5">
          {isPending ? (
            <Loader2 size={14} className="text-gray-400 animate-spin" />
          ) : (
            <>
              {user.banned ? (
                <button
                  onClick={handleUnban}
                  title="Unban user"
                  className="flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors"
                >
                  <ShieldCheck size={11} /> Unban
                </button>
              ) : (
                <button
                  onClick={handleBan}
                  title="Ban user"
                  className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  <ShieldOff size={11} /> Ban
                </button>
              )}
              <button
                onClick={handleDelete}
                title={confirmDelete ? "Click again to confirm" : "Delete user permanently"}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                  confirmDelete
                    ? "bg-red-600 text-white border-red-600 hover:bg-red-700"
                    : "text-red-400 bg-red-50 border-red-200 hover:bg-red-100"
                }`}
              >
                <Trash2 size={11} /> {confirmDelete ? "Confirm" : "Delete"}
              </button>
              {user.org_id && (
                <a
                  href={`/dashboard`}
                  target="_blank"
                  rel="noreferrer"
                  title="View org"
                  className="text-gray-300 hover:text-gray-500 transition-colors"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export function AdminTable({ users }: { users: AdminUser[] }) {
  const sorted = [...users].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px]">
        <thead>
          <tr className="text-left">
            {["User", "Workspace", "Joined", "Last active", "Usage", "Access", "Actions"].map(h => (
              <th key={h} className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50/60">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(u => <UserRow key={u.id} user={u} />)}
        </tbody>
      </table>
      {sorted.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">No users yet.</div>
      )}
    </div>
  );
}
