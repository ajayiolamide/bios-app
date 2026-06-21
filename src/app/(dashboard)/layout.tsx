import { redirect } from "next/navigation";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { OrgProvider } from "@/contexts/org-context";
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
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header user={user} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </OrgProvider>
  );
}
