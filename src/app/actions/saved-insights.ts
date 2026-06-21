"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";

// ─── Saved insights ────────────────────────────────────────────────────────────
// A small library AI-generated text gets pinned into, from wherever it was
// generated (Cohorts, AI Analyst, AI Business Brief, etc.) so it can later be
// picked from when building a report — instead of disappearing the moment
// you navigate away, or having to manually re-type/re-explain it to the
// report's AI prompt.

export type SavedInsight = {
  id: string;
  source: string;
  content: string;
  context: string | null;
  created_at: string;
};

export async function saveInsight(
  orgId: string,
  source: string,
  content: string,
  context?: string | null
): Promise<{ id?: string; error?: string }> {
  const trimmed = content.trim();
  if (!trimmed) return { error: "Nothing to save." };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("saved_insights")
    .insert({
      organization_id: orgId,
      created_by: user?.id ?? null,
      source,
      content: trimmed,
      context: context?.trim() || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

export async function getSavedInsights(orgId: string): Promise<SavedInsight[]> {
  if (!orgId) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("saved_insights")
    .select("id, source, content, context, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data;
}

export async function deleteSavedInsight(id: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("saved_insights").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}
