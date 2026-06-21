"use server";

import { redirect } from "next/navigation";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import type { Organization } from "@/types/database";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Create an org and return it (for client-side inline add — no redirect). */
export async function createOrganizationAndReturn(
  name: string
): Promise<{ org?: Organization; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return { error: "Name must be at least 2 characters." };
  if (trimmed.length > 60) return { error: "Name must be 60 characters or fewer." };

  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Not authenticated." };

  const admin = createAdminClient();

  // Duplicate check
  const { data: existing } = await admin
    .from("organization_members")
    .select("organizations!organization_members_organization_id_fkey(id, name)")
    .eq("user_id", user.id);
  const dupe = (existing ?? []).find(
    (m) => (m.organizations as unknown as { name: string })?.name?.toLowerCase() === trimmed.toLowerCase()
  );
  if (dupe) return { error: "You already have a company with that name." };

  const baseSlug = trimmed.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: trimmed, slug, owner_id: user.id })
    .select("*")
    .single();
  if (orgErr) return { error: orgErr.message };

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });
  if (memberErr) return { error: memberErr.message };

  return { org: org as Organization };
}

/** Remove (delete) an organization the current user owns, or leave one they're a member of. */
export async function removeOrganization(
  orgId: string
): Promise<{ error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const admin = createAdminClient();

  const { data: orgRow } = await admin
    .from("organizations")
    .select("owner_id")
    .eq("id", orgId)
    .single();

  if (orgRow?.owner_id === user.id) {
    // Owner — delete the whole org (FK cascades should remove memberships + data)
    const { error } = await admin.from("organizations").delete().eq("id", orgId);
    if (error) return { error: error.message };
  } else {
    // Member — just remove their membership (leave)
    const { error } = await admin
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };
  }

  return {};
}

/** Rename what this org calls the sub-goal layer under a Business Goal
 *  (default "Product Goal") — supports white-labeling the platform under a
 *  different vocabulary (e.g. "Initiative", "Workstream", "OKR"). */
export async function updateProductGoalLabel(
  orgId: string,
  label: string
): Promise<{ error?: string }> {
  const trimmed = label.trim();
  if (!trimmed) return { error: "Label can't be empty." };
  if (trimmed.length > 40) return { error: "Keep it under 40 characters." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ product_goal_label: trimmed })
    .eq("id", orgId);
  if (error) return { error: error.message };
  return {};
}

/** Fetch all orgs the current user belongs to — bypasses RLS via admin client. */
export async function getUserOrganizations(): Promise<Organization[]> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_members")
    .select("organizations!organization_members_organization_id_fkey(*)")
    .eq("user_id", user.id);

  if (error || !data) return [];

  return data
    .map((m) => m.organizations as unknown as Organization)
    .filter(Boolean);
}

export async function createOrganization(
  _prevState: { error: string } | { success: true } | null,
  formData: FormData
): Promise<{ error: string } | { success: true } | null> {
  const name = (formData.get("name") as string)?.trim();

  if (!name || name.length < 2) {
    return { error: "Organization name must be at least 2 characters." };
  }
  if (name.length > 60) {
    return { error: "Organization name must be 60 characters or fewer." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  // Prevent creating a duplicate org — if the user already owns one with this name, redirect there
  const { data: existingMemberships } = await admin
    .from("organization_members")
    .select("organizations!organization_members_organization_id_fkey(id, name)")
    .eq("user_id", user.id);

  const duplicate = (existingMemberships ?? []).find(
    (m) => (m.organizations as unknown as { name: string })?.name?.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    return { success: true }; // Just redirect to dashboard — they already have this org
  }

  const baseSlug = slugify(name) || "org";
  const suffix = Math.random().toString(36).slice(2, 7);
  const slug = `${baseSlug}-${suffix}`;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name, slug, owner_id: user.id })
    .select("id")
    .single();

  if (orgError) {
    console.error("[createOrganization] org insert failed:", {
      code: orgError.code,
      message: orgError.message,
      details: orgError.details,
      hint: orgError.hint,
    });
    return {
      error: `Could not create organization (${orgError.code}: ${orgError.message}).`,
    };
  }

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });

  if (memberError) {
    console.error("[createOrganization] member insert failed:", {
      code: memberError.code,
      message: memberError.message,
    });
    return {
      error: `Organization created but could not assign role (${memberError.code}: ${memberError.message}).`,
    };
  }

  return { success: true };
}
