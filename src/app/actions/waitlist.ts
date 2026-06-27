"use server";

import { createAdminClient } from "@/lib/supabase/server";

export async function joinWaitlist(
  email: string,
  goalDescription?: string
): Promise<{ success: boolean; message: string }> {
  if (!email || !email.includes("@")) {
    return { success: false, message: "Please enter a valid email." };
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("waitlist")
    .insert({
      email: email.toLowerCase().trim(),
      goal_description: goalDescription?.trim() || null,
    });

  if (error) {
    if (error.code === "23505") {
      // Already on list — update description if provided
      if (goalDescription?.trim()) {
        await admin
          .from("waitlist")
          .update({ goal_description: goalDescription.trim() })
          .eq("email", email.toLowerCase().trim());
      }
      return { success: true, message: "You're already on the list. We'll be in touch." };
    }
    console.error("Waitlist insert error:", error);
    return { success: false, message: "Something went wrong. Please try again." };
  }

  return { success: true, message: "You're on the list. We'll reach out when your spot is ready." };
}

// Called from /onboarding to pre-fill the textarea with what they typed on the landing page
export async function getWaitlistGoalDescription(
  email: string
): Promise<string | null> {
  if (!email) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("waitlist")
    .select("goal_description")
    .eq("email", email.toLowerCase().trim())
    .single();
  return data?.goal_description ?? null;
}
