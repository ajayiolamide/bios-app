import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getAdminData, getWaitlist, getAllowedEmails } from "@/app/actions/admin";
import { AdminTable } from "./admin-table";
import { WaitlistTable } from "./waitlist-table";
import { GuestListTable } from "./guest-list-table";
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

  // Filter the admin's own email out of the guest list — it's an owner entry, not an invite
  const guestListEmails = allowedEmails.filter(e => e.email !== ADMIN_EMAIL);
  const pendingInvites  = guestListEmails.filter(e => !e.used).length;

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

        {/* Guest list — invite management */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-gray-800">Invites &amp; access</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Invited emails can sign up. Invited users do <strong>not</strong> receive an email automatically — share the sign-up link separately.
              </p>
            </div>
            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-xs text-gray-400">{guestListEmails.length} invited</p>
              {pendingInvites > 0 && (
                <p className="text-[11px] text-amber-500 font-medium">{pendingInvites} pending</p>
              )}
            </div>
          </div>
          <GuestListTable rows={guestListEmails} />
        </div>

        {/* Waitlist */}
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-800">Waitlist</p>
            <p className="text-xs text-gray-400">{waitlist.length} waiting</p>
          </div>
          <WaitlistTable rows={waitlist} />
        </div>

      </div>
    </div>
  );
}
