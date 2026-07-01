import { redirect } from "next/navigation";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { OrgProvider } from "@/contexts/org-context";
import { NavigationLoader } from "@/components/ui/navigation-loader";
import type { Organization } from "@/types/database";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Use admin client to fetch orgs — guaranteed to bypass RLS
  const admin = createAdminClient();
  const { data: memberships, error: membershipsError } = await admin
    .from("organization_members")
    .select("organizations!organization_members_organization_id_fkey(*)")
    .eq("user_id", user.id);

  // A failed query here (e.g. an invalid/expired SUPABASE_SERVICE_ROLE_KEY)
  // looks IDENTICAL to "this user genuinely has no orgs" if we don't check
  // for it — both end up with an empty/null memberships array, both redirect
  // to /create-workspace. That's exactly what made a bad service-role key
  // indistinguishable from a real onboarding case. Logging it loudly here
  // means a broken key shows up as a clear server error instead of a
  // confusing "why do I have no workspace" loop.
  if (membershipsError) {
    console.error("Failed to fetch org memberships — check SUPABASE_SERVICE_ROLE_KEY is valid:", membershipsError);
    throw new Error(`Could not load your organizations: ${membershipsError.message}`);
  }

  // Same Supabase generated-type `never[]` inference issue as elsewhere in
  // this codebase — explicit shape here matches exactly what the .select()
  // above returns, no behavior change.
  type MembershipRow = { organizations: Organization };
  const seen = new Set<string>();
  const orgs = ((memberships ?? []) as MembershipRow[])
    .map((m) => m.organizations)
    .filter(Boolean)
    .filter((org) => {
      if (seen.has(org.id)) return false;
      seen.add(org.id);
      return true;
    });

  if (orgs.length === 0) redirect("/create-workspace");

  return (
    <OrgProvider initialOrgs={orgs}>
      {/* Mobile blocker — shown on screens narrower than md (768px) */}
      <div className="md:hidden fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-indigo-500">
            <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="12" cy="18" r="1" fill="currentColor"/>
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2 tracking-tight">
          Please use a larger screen
        </h2>
        <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
          Metrik is designed for desktop. Open it on your laptop or desktop for the best experience.
        </p>
      </div>

      {/* Main app — hidden on mobile, shown md and above */}
      <div className="hidden md:flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header user={user} />
          <NavigationLoader>{children}</NavigationLoader>
        </div>
      </div>
    </OrgProvider>
  );
}
