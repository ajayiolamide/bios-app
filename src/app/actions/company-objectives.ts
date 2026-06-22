"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { CompanyObjective } from "@/types/database";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Must stay in sync with TIMEFRAMES in goals/page.tsx (small, stable enum —
// not worth threading through a shared module from a client component).
const TIMEFRAME_VALUES = [
  "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026",
  "H1 2026", "H2 2026", "Annual 2026",
  "Q1 2027", "Annual 2027",
];

// ─── AI: turn a plain-English description into a structured company objective ─
//
// Same guided pattern as the Product Goal wizard, applied one level up —
// the whole point being one consistent, AI-assisted creation experience
// across the goal hierarchy instead of a polished flow at one layer and a
// blank form at another.
export async function proposeObjectiveFromDescription(
  description: string
): Promise<{ title?: string; target?: string; timeframe?: string; description?: string; error?: string }> {
  if (!description.trim()) return { error: "Describe the one big thing you're trying to achieve first." };

  const prompt = `A non-technical business leader is creating the company's top-level objective — "the one big thing" — on an internal BI tool called Metrik. They described it in their own words; turn it into a clean, structured objective they can confirm or tweak.

Their description: "${description.trim()}"

Pick the single best-fitting timeframe from exactly this list: ${TIMEFRAME_VALUES.join(", ")}. If nothing in their description implies a timeframe, default to the soonest quarter in that list.

Return ONLY this JSON, no markdown fences, no commentary:
{
  "title": "short, punchy objective title, under 14 words",
  "target": "short target text, e.g. '98% activation, NPS 58+' — pull concrete numbers from their description if they gave any, otherwise propose a reasonable placeholder they can edit",
  "timeframe": "one of the timeframe values above, exactly as written",
  "description": "one sentence on why this matters to the business, in their own words where possible"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as { title: string; target: string; timeframe: string; description: string };
    return parsed;
  } catch (err) {
    console.error("[proposeObjectiveFromDescription]", err);
    return { error: "Couldn't generate a suggestion — try rephrasing, or fill the fields in yourself below." };
  }
}

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
