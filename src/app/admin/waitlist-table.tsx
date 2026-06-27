"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { approveWaitlistEmail, rejectWaitlistEmail } from "@/app/actions/admin";

type WaitlistRow = { email: string; joined_at: string };

export function WaitlistTable({ rows }: { rows: WaitlistRow[] }) {
  const [items, setItems] = useState(rows);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    </div>
  );
}
