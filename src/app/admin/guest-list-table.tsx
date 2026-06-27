"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2, UserPlus, Mail, XCircle } from "lucide-react";
import { removeAllowedEmail, addAllowedEmail } from "@/app/actions/admin";

type GuestRow = { email: string; note: string | null; invited_at: string; used: boolean };

export function GuestListTable({ rows }: { rows: GuestRow[] }) {
  const [items, setItems] = useState(rows);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [invitePending, startInvite] = useTransition();
  const [inviteMsg, setInviteMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function handleRemove(email: string, isActive: boolean) {
    const label = isActive
      ? `Remove ${email} from the guest list? They won't be able to sign up again.`
      : `Revoke invite for ${email}?`;
    if (!confirm(label)) return;
    setPendingEmail(email);
    startTransition(async () => {
      try {
        await removeAllowedEmail(email);
        setItems(prev => prev.filter(r => r.email !== email));
      } catch {
        // server will revalidate
      } finally {
        setPendingEmail(null);
      }
    });
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.includes("@")) return;
    setInviteMsg(null);
    startInvite(async () => {
      try {
        await addAllowedEmail(inviteEmail, inviteNote || undefined);
        setItems(prev => [
          { email: inviteEmail.toLowerCase().trim(), note: inviteNote || null, invited_at: new Date().toISOString(), used: false },
          ...prev.filter(r => r.email !== inviteEmail.toLowerCase().trim()),
        ]);
        setInviteMsg({ text: `${inviteEmail} added — share the sign-up link so they can register.`, ok: true });
        setInviteEmail("");
        setInviteNote("");
      } catch (err) {
        setInviteMsg({ text: (err as Error).message ?? "Something went wrong.", ok: false });
      }
    });
  }

  return (
    <div>
      {/* Invite form */}
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <UserPlus size={11} /> Invite someone
        </p>
        <form onSubmit={handleInvite} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="email"
              required
              placeholder="email@company.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <input
            type="text"
            placeholder="Note (optional)"
            value={inviteNote}
            onChange={e => setInviteNote(e.target.value)}
            className="w-36 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={invitePending}
            className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            {invitePending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            Add to list
          </button>
        </form>
        {inviteMsg && (
          <p className={`text-xs mt-2 ${inviteMsg.ok ? "text-green-600" : "text-red-500"}`}>{inviteMsg.text}</p>
        )}
      </div>

      {/* Guest list table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {["Email", "Note", "Invited", "Status", ""].map(h => (
              <th key={h} className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">
                No invites yet. Add someone above to give them access.
              </td>
            </tr>
          )}
          {items.map((row) => {
            const busy = isPending && pendingEmail === row.email;
            return (
              <tr key={row.email} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3.5 font-medium text-gray-900">{row.email}</td>
                <td className="px-6 py-3.5 text-gray-400 text-xs">{row.note ?? "—"}</td>
                <td className="px-6 py-3.5 text-gray-400 text-xs">
                  {new Date(row.invited_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="px-6 py-3.5">
                  {row.used ? (
                    <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">
                      Signed up
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                      Pending
                    </span>
                  )}
                </td>
                <td className="px-6 py-3.5 text-right">
                  {busy ? (
                    <Loader2 size={13} className="animate-spin text-gray-400 ml-auto" />
                  ) : (
                    <button
                      onClick={() => handleRemove(row.email, row.used)}
                      className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700 ml-auto transition-colors"
                    >
                      {row.used ? <Trash2 size={12} /> : <XCircle size={12} />}
                      {row.used ? "Remove" : "Revoke invite"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
