import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getAdminData, getWaitlist, getAllowedEmails } from "@/app/actions/admin";
import { AdminTable } from "./admin-table";
import { ShieldCheck, Users, BarChart3, FileText, Lightbulb } from "lucide-react";

const ADMIN_EMAIL = "ajayiibrahimme@gmail.com";

export default async function AdminPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (user.email !== ADMIN_EMAIL) redirect("/dashboard");

  const [users, waitlist, allowedEmails] = await Promise.all([
    getAdminData(),
    getWaitlist(),
    getAllowedEmails(),
  ]);

  const totalUsers   = users.length;
  const activeUsers  = users.filter(u => !u.banned).length;
  const bannedUsers  = users.filter(u => u.banned).length;
  const withOrg      = users.filter(u => u.org_id).length;
  const totalEvents  = users.reduce((s, u) => s + u.events, 0);
  const totalFeatures= users.reduce((s, u) => s + u.features, 0);
  const totalReports = users.reduce((s, u) => s + u.reports, 0);

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ShieldCheck size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Metrik Admin</p>
              <p className="text-xs text-gray-400">Beta control panel</p>
            </div>
          </div>
          <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            ← Back to app
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Total users",    value: totalUsers,    icon: Users,      color: "text-indigo-500 bg-indigo-50" },
            { label: "Active",         value: activeUsers,   icon: Users,      color: "text-green-500 bg-green-50" },
            { label: "Banned",         value: bannedUsers,   icon: Users,      color: "text-red-400 bg-red-50" },
            { label: "With workspace", value: withOrg,       icon: Users,      color: "text-violet-500 bg-violet-50" },
            { label: "Events ingested",value: totalEvents.toLocaleString(),  icon: BarChart3, color: "text-blue-500 bg-blue-50" },
            { label: "Features logged",value: totalFeatures, icon: Lightbulb,  color: "text-amber-500 bg-amber-50" },
            { label: "Reports made",   value: totalReports,  icon: FileText,   color: "text-teal-500 bg-teal-50" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
              <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center mb-2`}>
                <Icon size={13} />
              </div>
              <p className="text-xl font-black text-gray-900">{value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-800">All beta users</p>
            <p className="text-xs text-gray-400">{totalUsers} total</p>
          </div>
          <AdminTable users={users} />
        </div>

        {/* Waitlist */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-800">Waitlist</p>
            <p className="text-xs text-gray-400">{waitlist.length} total</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Email</th>
                <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.length === 0 && (
                <tr><td colSpan={2} className="px-6 py-6 text-center text-gray-400 text-sm">No signups yet.</td></tr>
              )}
              {waitlist.map((row) => (
                <tr key={row.email} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3.5 font-medium text-gray-900">{row.email}</td>
                  <td className="px-6 py-3.5 text-gray-400 text-xs">{new Date(row.joined_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Guest list */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-800">Guest list (allowed emails)</p>
            <p className="text-xs text-gray-400">{allowedEmails.length} total</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {["Email", "Note", "Invited", "Signed up"].map((h) => (
                  <th key={h} className="text-left px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allowedEmails.map((row) => (
                <tr key={row.email} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3.5 font-medium text-gray-900">{row.email}</td>
                  <td className="px-6 py-3.5 text-gray-400">{row.note ?? "—"}</td>
                  <td className="px-6 py-3.5 text-gray-400 text-xs">{new Date(row.invited_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="px-6 py-3.5">
                    {row.used
                      ? <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">Yes</span>
                      : <span className="text-xs text-gray-400">Pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
