"use server";

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Checks if an email is on the allowed_emails guest list.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 * Uses the admin client so RLS doesn't block the lookup.
 */
export async function checkEmailAllowed(
  email: string
): Promise<{ allowed: boolean; reason?: string }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("allowed_emails")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (error) {
    console.error("allowed_emails lookup failed:", error);
    // Fail closed — if we can't check, don't let them in
    return { allowed: false, reason: "Unable to verify access. Please try again." };
  }

  if (!data) {
    return {
      allowed: false,
      reason: "Metrik is currently invite-only. If you'd like access, join the waitlist.",
    };
  }

  return { allowed: true };
}

/**
 * Marks an email as used once they've successfully signed up.
 */
export async function markEmailUsed(email: string) {
  const admin = createAdminClient();
  await admin
    .from("allowed_emails")
    .update({ used: true })
    .eq("email", email.toLowerCase().trim());
}
