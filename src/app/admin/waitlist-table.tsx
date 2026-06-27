"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, Loader2, UserPlus, Mail } from "lucide-react";
import { approveWaitlistEmail, rejectWaitlistEmail, addAllowedEmail } from "@/app/actions/admin";

type WaitlistRow = { email: string; joined_at: string };

export function WaitlistTable({ rows }: { rows: WaitlistRow[] }) {
  const [items, setItems] = useState(rows);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // "Invite" form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote]   = useState("");
  const [invitePending, startInvite]  = useTransition();
  const [inviteMsg, setInviteMsg]     = useState<string | null>(null);

  function handleApprove(email: string) {
    setPendingEmail(email);
    startTransition(async () => {
      try {
        await approveWaitlistEmail(email);
        setItems(prev => prev.filter(r => r.email !== email));
      } catch {
        // server will revalidate; just clear spinner
      } finally {
        setPendingEmail(null);
      }
    });
  }

  function handleReject(email: string) {
    if (!confirm(`Remove ${email} from waitlist?`)) return;
    setPendingEmail(email);
    startTransition(async () => {
      try {
        await rejectWaitlistEmail(email);
        setItems(prev => prev.filter(r => r.email !== email));
      } catch {
        // no-op
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
        setInviteMsg(`${inviteEmail} added to guest list.`);
        setInviteEmail("");
        setInviteNote("");
      } catch (err) {
        setInviteMsg((err as Error).message ?? "Something went wrong.");
      }
    });
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Email</th>
            <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Joined</th>
            <th className="px-6 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={3} className="px-6 py-6 text-center text-gray-400 text-sm">No signups yet.</td>
            </tr>
          )}
          {items.map((row) => {
            const busy = isPending && pendingEmail === row.email;
            return (
              <tr key={row.email} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3.5 font-medium text-gray-900">{row.email}</td>
                <td className="px-6 py-3.5 text-gray-400 text-xs">
                  {new Date(row.joined_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="px-6 py-3.5">
                  <div className="flex items-center justify-end gap-2">
                    {busy ? (
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    ) : (
                      <>
                        <button
                          onClick={() => handleApprove(row.email)}
                          className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-100 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors"
                        >
                          <CheckCircle2 size={12} /> Approve
                        </button>
                        <button
                          onClick={() => handleReject(row.email)}
                          className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-2.5 py-1 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          <XCircle size={12} /> Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Quick invite form */}
      <div className="px-6 py-4 border-t border-gray-50 bg-gray-50/50">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <UserPlus size={11} /> Invite directly (skip waitlist)
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
            Invite
          </button>
        </form>
        {inviteMsg && (
          <p className="text-xs text-gray-500 mt-2">{inviteMsg}</p>
        )}
      </div>
    </div>
  );
}
