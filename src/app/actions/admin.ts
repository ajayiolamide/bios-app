"use server";

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const ADMIN_EMAIL = "ajayiibrahimme@gmail.com";

// Service-role admin client — never exposed to the browser
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function assertAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }
}

// ─── Ban a user (effectively permanent — 10 years) ────────────────────────────
export async function banUser(userId: string) {
  await assertAdmin();
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "87600h", // 10 years
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// ─── Unban a user ─────────────────────────────────────────────────────────────
export async function unbanUser(userId: string) {
  await assertAdmin();
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// ─── Delete a user entirely (irreversible) ────────────────────────────────────
export async function deleteUser(userId: string) {
  await assertAdmin();
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// ─── Fetch all beta users with their org + usage data ─────────────────────────
export async function getAdminData() {
  await assertAdmin();
  const admin = getAdminClient();

  // Auth users (up to 1000 for beta)
  const { data: { users }, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw new Error(usersError.message);

  // All organisations
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name, owner_id, created_at");

  // Brand settings (company name per org)
  const { data: brandSettings } = await admin
    .from("brand_settings")
    .select("organization_id, company_name");

  // Usage counts — run in parallel
  const [
    { data: eventCounts },
    { data: featureCounts },
    { data: reportCounts },
  ] = await Promise.all([
    admin.from("events").select("organization_id"),
    admin.from("feature_metrics").select("organization_id"),
    admin.from("reports").select("organization_id"),
  ]);

  // Build per-org lookup maps
  const brandMap = Object.fromEntries(
    (brandSettings ?? []).map(b => [b.organization_id, b.company_name])
  );
  const eventsMap: Record<string, number> = {};
  (eventCounts ?? []).forEach(e => { eventsMap[e.organization_id] = (eventsMap[e.organization_id] ?? 0) + 1; });
  const featuresMap: Record<string, number> = {};
  (featureCounts ?? []).forEach(f => { featuresMap[f.organization_id] = (featuresMap[f.organization_id] ?? 0) + 1; });
  const reportsMap: Record<string, number> = {};
  (reportCounts ?? []).forEach(r => { reportsMap[r.organization_id] = (reportsMap[r.organization_id] ?? 0) + 1; });

  // Build per-user org lookup
  const orgsByOwner: Record<string, typeof orgs extends null ? never : (typeof orgs)[number]> = {};
  (orgs ?? []).forEach(o => { orgsByOwner[o.owner_id] = o; });

  return users.map(u => {
    const org = orgsByOwner[u.id];
    const orgId = org?.id;
    return {
      id: u.id,
      email: u.email ?? "—",
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at ?? null,
      banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
      banned_until: u.banned_until ?? null,
      org_name: orgId ? (brandMap[orgId] ?? org?.name ?? "Unnamed") : null,
      org_id: orgId ?? null,
      events: orgId ? (eventsMap[orgId] ?? 0) : 0,
      features: orgId ? (featuresMap[orgId] ?? 0) : 0,
      reports: orgId ? (reportsMap[orgId] ?? 0) : 0,
    };
  });
}

export type AdminUser = Awaited<ReturnType<typeof getAdminData>>[number];

// ─── Waitlist ─────────────────────────────────────────────────────────────────
export async function getWaitlist() {
  await assertAdmin();
  const admin = getAdminClient();
  const { data } = await admin
    .from("waitlist")
    .select("email, joined_at")
    .order("joined_at", { ascending: false });
  return data ?? [];
}

// ─── Allowed emails (guest list) ─────────────────────────────────────────────
export async function getAllowedEmails() {
  await assertAdmin();
  const admin = getAdminClient();
  const { data } = await admin
    .from("allowed_emails")
    .select("email, note, invited_at, used")
    .order("invited_at", { ascending: false });
  return data ?? [];
}
