"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { BrandSettings, ReportTemplate } from "@/types/database";

// ─── Brand Settings ───────────────────────────────────────────────────────────

export async function getBrandSettings(orgId: string): Promise<BrandSettings | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("brand_settings")
    .select("*")
    .eq("organization_id", orgId)
    .single();
  return data ?? null;
}

export async function saveBrandSettings(
  orgId: string,
  payload: {
    company_name: string;
    primary_color: string;
    secondary_color: string;
    slack_webhook: string;
    logo_url?: string;
  }
): Promise<{ error: string | null }> {
  const admin = createAdminClient();

  const existing = await getBrandSettings(orgId);

  const values = {
    company_name: payload.company_name.trim() || null,
    primary_color: payload.primary_color || "#6366f1",
    secondary_color: payload.secondary_color || "#a5b4fc",
    slack_webhook: payload.slack_webhook.trim() || null,
    ...(payload.logo_url !== undefined ? { logo_url: payload.logo_url } : {}),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await admin
      .from("brand_settings")
      .update(values)
      .eq("organization_id", orgId);
    return { error: error?.message ?? null };
  } else {
    const { error } = await admin.from("brand_settings").insert({
      organization_id: orgId,
      ...values,
    });
    return { error: error?.message ?? null };
  }
}

// ─── Report Templates ─────────────────────────────────────────────────────────

export async function getReportTemplates(orgId: string): Promise<ReportTemplate[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("report_templates")
    .select("*")
    .eq("organization_id", orgId)
    .order("order_index", { ascending: true });
  return data ?? [];
}

export async function createReportTemplate(
  orgId: string,
  payload: { name: string; instructions: string; slide_hint: number }
): Promise<{ error: string | null }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();

  // Get current max order_index
  const { data: existing } = await admin
    .from("report_templates")
    .select("order_index")
    .eq("organization_id", orgId)
    .order("order_index", { ascending: false })
    .limit(1);

  const nextIndex = existing && existing.length > 0 ? existing[0].order_index + 1 : 0;

  const { error } = await admin.from("report_templates").insert({
    organization_id: orgId,
    name: payload.name.trim(),
    instructions: payload.instructions.trim(),
    slide_hint: payload.slide_hint,
    order_index: nextIndex,
  });

  return { error: error?.message ?? null };
}

export async function updateReportTemplate(
  templateId: string,
  payload: { name: string; instructions: string; slide_hint: number }
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("report_templates")
    .update({
      name: payload.name.trim(),
      instructions: payload.instructions.trim(),
      slide_hint: payload.slide_hint,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId);
  return { error: error?.message ?? null };
}

export async function deleteReportTemplate(templateId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("report_templates").delete().eq("id", templateId);
  return { error: error?.message ?? null };
}

// ─── Seed default templates ───────────────────────────────────────────────────

export async function seedDefaultTemplates(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("report_templates")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);

  if (existing && existing.length > 0) return; // already seeded

  const defaults = [
    {
      name: "Product Team",
      instructions:
        "Deep-dive report for the internal product team. Include all metrics, highlight which ones are off-track vs on-track, show trends over time, call out specific areas that need attention, and suggest next actions. Use technical language. Aim for detail — include breakdowns by platform or category where relevant.",
      slide_hint: 12,
      order_index: 0,
    },
    {
      name: "Stakeholders",
      instructions:
        "Report for business stakeholders and senior managers. Focus on KPIs, growth trends, wins, and risks. Avoid raw event data or technical details. Summarise performance against targets. Use clear, business-friendly language. Show month-on-month comparisons where available.",
      slide_hint: 8,
      order_index: 1,
    },
    {
      name: "Management",
      instructions:
        "Executive summary for C-suite and board. Maximum 5 slides. Lead with the most important business outcome, highlight what is on track vs off track, state the single most important risk and the single most important opportunity. No data tables. No jargon. Every slide must have a clear headline insight.",
      slide_hint: 5,
      order_index: 2,
    },
  ];

  await admin.from("report_templates").insert(
    defaults.map((d) => ({ ...d, organization_id: orgId }))
  );
}
