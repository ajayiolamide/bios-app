"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { removeAllowedEmail } from "@/app/actions/admin";

type GuestRow = { email: string; note: string | null; invited_at: string; used: boolean };

export function GuestListTable({ rows }: { rows: GuestRow[] }) {
  const [items, setItems] = useState(rows);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRemove(email: string) {
    if (!confirm(`Remove ${email} from the guest list? They won't be able to sign up.`)) return;
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

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          {["Email", "Note", "Invited", "Signed up", ""].map(h => (
            <th key={h} className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && (
          <tr>
            <td colSpan={5} className="px-6 py-6 text-center text-gray-400 text-sm">No emails on the guest list yet.</td>
          </tr>
        )}
        {items.map((row) => {
          const busy = isPending && pendingEmail === row.email;
          return (
            <tr key={row.email} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="px-6 py-3.5 font-medium text-gray-900">{row.email}</td>
              <td className="px-6 py-3.5 text-gray-400">{row.note ?? "—"}</td>
              <td className="px-6 py-3.5 text-gray-400 text-xs">
                {new Date(row.invited_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </td>
              <td className="px-6 py-3.5">
                {row.used
                  ? <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">Yes</span>
                  : <span className="text-xs text-gray-400">Pending</span>}
              </td>
              <td className="px-6 py-3.5 text-right">
                {busy ? (
                  <Loader2 size={13} className="animate-spin text-gray-400 ml-auto" />
                ) : (
                  <button
                    onClick={() => handleRemove(row.email)}
                    className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700 ml-auto transition-colors"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
