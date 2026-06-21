"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { CompanyObjective } from "@/types/database";

// ─── Get all company objectives for an org ─────────────────────────────────
// These are the real, company-wide "Business Goals" — the one or two big
// things for the quarter/year that every narrower Product Goal (the
// business_goals table, despite its name) ladders up to.

export async function getCompanyObjectives(orgId: string): Promise<CompanyObjective[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_objectives")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return (data ?? []) as CompanyObjective[];
}

// ─── Create a new company objective ────────────────────────────────────────

export async function createCompanyObjective(
  orgId: string,
  payload: { title: string; description?: string; target?: string; timeframe?: string }
): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_objectives")
    .insert({
      organization_id: orgId,
      created_by: user.id,
      title: payload.title,
      description: payload.description || null,
      target: payload.target || null,
      timeframe: payload.timeframe || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

// ─── Update status ──────────────────────────────────────────────────────────

export async function updateCompanyObjectiveStatus(
  id: string,
  status: CompanyObjective["status"]
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("company_objectives").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  return {};
}

// ─── Delete (hard) ──────────────────────────────────────────────────────────
// Product Goals linked to this objective aren't deleted — their
// company_objective_id just falls back to null (unassigned) via the
// migration's "on delete set null".

export async function deleteCompanyObjective(id: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("company_objectives").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}

// ─── Assign / re-assign which company objective a Product Goal belongs to ──

export async function setGoalObjective(
  goalId: string,
  companyObjectiveId: string | null
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("business_goals")
    .update({ company_objective_id: companyObjectiveId })
    .eq("id", goalId);
  if (error) return { error: error.message };
  return {};
}
