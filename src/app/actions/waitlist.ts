"use server";

import { createAdminClient } from "@/lib/supabase/server";

export async function joinWaitlist(
  email: string
): Promise<{ success: boolean; message: string }> {
  if (!email || !email.includes("@")) {
    return { success: false, message: "Please enter a valid email." };
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("waitlist")
    .insert({ email: email.toLowerCase().trim() });

  if (error) {
    if (error.code === "23505") {
      return { success: true, message: "You're already on the list. We'll be in touch." };
    }
    console.error("Waitlist insert error:", error);
    return { success: false, message: "Something went wrong. Please try again." };
  }

  return { success: true, message: "You're on the list. We'll reach out when your spot is ready." };
}
