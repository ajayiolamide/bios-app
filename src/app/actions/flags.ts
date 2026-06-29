"use server";

import { createServerClient, createAdminClient } from "@/lib/supabase/server";

export type OrgFeatureFlags = {
  ai_enabled: boolean;
  reports_enabled: boolean;
  cohorts_enabled: boolean;
};

// Defaults — all features on. Used when the column is null or missing a key.
const DEFAULTS: OrgFeatureFlags = {
  ai_enabled: true,
  reports_enabled: true,
  cohorts_enabled: true,
};

/**
 * Returns the feature flags for the current user's org.
 * Falls back to all-enabled if the org has no flags set yet.
 * Safe to call from any server component — returns defaults on any error.
 */
export async function getMyOrgFlags(): Promise<OrgFeatureFlags> {
  try {
    // Use server client only to identify the user, then admin client for DB
    // queries so RLS policies don't interfere.
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return DEFAULTS;

    const admin = createAdminClient();

    const { data: membership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!membership) return DEFAULTS;

    const { data: org } = await admin
      .from("organizations")
      .select("feature_flags")
      .eq("id", membership.organization_id)
      .single();
    if (!org?.feature_flags) return DEFAULTS;

    // Merge with defaults so any missing keys stay enabled
    return { ...DEFAULTS, ...(org.feature_flags as Partial<OrgFeatureFlags>) };
  } catch {
    return DEFAULTS;
  }
}
