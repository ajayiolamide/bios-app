"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import type { SlideContent, SlidesDeck } from "./reports";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type SlideComment = {
  id: string;
  review_id: string;
  slide_index: number;
  reviewer_name: string;
  comment_text: string;
  resolved: boolean;
  created_at: string;
};

// ─── Create a shareable review session ───────────────────────────────────────

export async function createReviewSession(
  orgId: string,
  deck: SlidesDeck,
  period: string
): Promise<{ token: string | null; reviewId: string | null; error: string | null }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { token: null, reviewId: null, error: "Not authenticated" };

  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const admin = createAdminClient();

  const { data, error } = await admin.from("report_reviews").insert({
    organization_id: orgId,
    deck_json: deck as unknown,
    deck_title: deck.title,
    period,
    share_token: token,
    created_by: user.id,
    status: "open",
    // expires_at and is_private use DB column defaults — set later via updateReviewAccess
  }).select("id").single();

  if (error) return { token: null, reviewId: null, error: error.message };
  return { token, reviewId: data.id, error: null };
}

// ─── Update access control on a review session ───────────────────────────────

export async function updateReviewAccess(
  reviewId: string,
  opts: { expiresAt?: string | null; isPrivate?: boolean }
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if ("expiresAt" in opts) update.expires_at = opts.expiresAt ?? null;
  if ("isPrivate" in opts) update.is_private = opts.isPrivate;
  const { error } = await admin.from("report_reviews").update(update).eq("id", reviewId);
  return { error: error?.message ?? null };
}

// ─── Get review session by token (public — no auth) ──────────────────────────

export async function getReviewSession(token: string): Promise<{
  review: { id: string; deck: SlidesDeck; deck_title: string; period: string; status: string; brand: { primary: string; secondary: string; logoUrl: string | null } } | null;
  comments: SlideComment[];
  error: string | null;
  errorType?: "not_found" | "private" | "expired";
}> {
  const admin = createAdminClient();

  const { data: review, error } = await admin
    .from("report_reviews")
    .select("*")
    .eq("share_token", token)
    .single();

  if (error || !review) return { review: null, comments: [], error: "Review not found", errorType: "not_found" };

  // Access control checks (columns may not exist yet if migration 014 hasn't been run)
  if (review.is_private === true) {
    return { review: null, comments: [], error: "This report has been made private.", errorType: "private" };
  }
  if (review.expires_at && new Date(review.expires_at) < new Date()) {
    return { review: null, comments: [], error: "This link has expired.", errorType: "expired" };
  }

  // Fetch brand colors + logo via org so the review page matches the creator's brand
  let brand: { primary: string; secondary: string; logoUrl: string | null } = { primary: "#6366f1", secondary: "#a5b4fc", logoUrl: null };
  if (review.organization_id) {
    const { data: bs } = await admin
      .from("brand_settings")
      .select("primary_color, secondary_color, logo_url")
      .eq("organization_id", review.organization_id)
      .single();
    if (bs) brand = { primary: bs.primary_color, secondary: bs.secondary_color, logoUrl: bs.logo_url ?? null };
  }

  const { data: comments } = await admin
    .from("slide_comments")
    .select("*")
    .eq("review_id", review.id)
    .order("created_at", { ascending: true });

  return {
    review: {
      id: review.id,
      deck: review.deck_json as SlidesDeck,
      deck_title: review.deck_title,
      period: review.period,
      status: review.status,
      brand,
    },
    comments: (comments ?? []) as SlideComment[],
    error: null,
  };
}

// ─── Get a review session by id, for its OWNER (authenticated) ───────────────
// getReviewSession above is the public-facing lookup used by the share link
// itself — it deliberately refuses to return anything for a private or
// expired link, because a random visitor with the token shouldn't be able to
// tell those apart from "not found". That's wrong for the owner: if they
// privated their own link and come back to flip it public again, or want to
// change the expiry date, that same gate would lock them out of their own
// settings. This is the authenticated equivalent used by the History tab.
export async function getReviewSessionForOwner(reviewId: string): Promise<{
  review: {
    id: string; deck: SlidesDeck; deck_title: string; period: string; status: string;
    share_token: string; is_private: boolean; expires_at: string | null;
    brand: { primary: string; secondary: string; logoUrl: string | null };
  } | null;
  error: string | null;
}> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { review: null, error: "Not authenticated" };

  const admin = createAdminClient();
  const { data: review, error } = await admin
    .from("report_reviews")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (error || !review) return { review: null, error: "Review not found" };

  let brand: { primary: string; secondary: string; logoUrl: string | null } = { primary: "#6366f1", secondary: "#a5b4fc", logoUrl: null };
  if (review.organization_id) {
    const { data: bs } = await admin
      .from("brand_settings")
      .select("primary_color, secondary_color, logo_url")
      .eq("organization_id", review.organization_id)
      .single();
    if (bs) brand = { primary: bs.primary_color, secondary: bs.secondary_color, logoUrl: bs.logo_url ?? null };
  }

  return {
    review: {
      id: review.id,
      deck: review.deck_json as SlidesDeck,
      deck_title: review.deck_title,
      period: review.period,
      status: review.status,
      share_token: review.share_token,
      is_private: review.is_private ?? false,
      expires_at: review.expires_at ?? null,
      brand,
    },
    error: null,
  };
}

// ─── Get all review sessions for an org (for History tab) ────────────────────

export async function getOrgReviewSessions(orgId: string): Promise<{
  id: string; deck_title: string; period: string; share_token: string;
  status: string; created_at: string; comment_count: number;
  is_private: boolean; expires_at: string | null;
}[]> {
  const admin = createAdminClient();
  const { data: reviews } = await admin
    .from("report_reviews")
    .select("id, deck_title, period, share_token, status, created_at, is_private, expires_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (!reviews?.length) return [];

  const ids = reviews.map(r => r.id);
  const { data: comments } = await admin
    .from("slide_comments")
    .select("review_id")
    .in("review_id", ids)
    .eq("resolved", false);

  const countMap: Record<string, number> = {};
  (comments ?? []).forEach((c: { review_id: string }) => { countMap[c.review_id] = (countMap[c.review_id] ?? 0) + 1; });

  return reviews.map(r => ({
    ...r,
    comment_count: countMap[r.id] ?? 0,
    is_private: r.is_private ?? false,
    expires_at: r.expires_at ?? null,
  }));
}

export async function deleteReviewSession(reviewId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("report_reviews").delete().eq("id", reviewId);
  return { error: error?.message ?? null };
}

// ─── Send email invites for a review session ─────────────────────────────────

export async function sendEmailInvites(
  reviewId: string,
  reviewUrl: string,
  deckTitle: string,
  period: string,
  emails: string[],
  expiresAt?: string | null
): Promise<{ sent: number; failed: string[]; error?: string }> {
  const admin = createAdminClient();
  const clean = emails.map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!clean.length) return { sent: 0, failed: [], error: "No valid email addresses found" };

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@yourdomain.com";
  const failed: string[] = [];
  let sent = 0;

  const expiryLine = expiresAt
    ? `\n\nThis link is valid until ${new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
    : "";

  for (const email of clean) {
    if (apiKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: email,
            subject: `Report ready: ${deckTitle} — ${period}`,
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#111827;">
                <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">${deckTitle}</h2>
                <p style="font-size:14px;color:#6B7280;margin:0 0 24px;">${period}</p>
                <p style="font-size:15px;line-height:1.6;margin:0 0 32px;">
                  A report has been shared with you. Click the button below to view the slides and leave feedback.
                </p>
                <a href="${reviewUrl}" style="display:inline-block;background:#4F46E5;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
                  👁 View Report
                </a>
                <p style="font-size:12px;color:#9CA3AF;margin-top:32px;">${expiryLine}</p>
              </div>
            `,
          }),
        });
        if (res.ok) sent++;
        else failed.push(email);
      } catch {
        failed.push(email);
      }
    } else {
      // No email provider — mark as "sent" (caller will show copy-link fallback)
      sent++;
    }
  }

  // Record invited emails on the review row
  const now = new Date().toISOString();
  const { data: existing } = await admin.from("report_reviews").select("invited_emails").eq("id", reviewId).single();
  const current: { email: string; expires_at: string | null; sent_at: string }[] =
    (existing?.invited_emails as { email: string; expires_at: string | null; sent_at: string }[] | null) ?? [];
  const merged = [
    ...current.filter(r => !clean.includes(r.email)),
    ...clean.map(e => ({ email: e, expires_at: expiresAt ?? null, sent_at: now })),
  ];
  await admin.from("report_reviews").update({ invited_emails: merged }).eq("id", reviewId);

  return { sent, failed };
}

// ─── Add a comment (public — no auth needed) ─────────────────────────────────

export async function addSlideComment(
  reviewId: string,
  slideIndex: number,
  reviewerName: string,
  commentText: string
): Promise<{ comment: SlideComment | null; error: string | null }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("slide_comments")
    .insert({ review_id: reviewId, slide_index: slideIndex, reviewer_name: reviewerName.trim() || "Reviewer", comment_text: commentText.trim() })
    .select("*")
    .single();

  if (error) return { comment: null, error: error.message };
  return { comment: data as SlideComment, error: null };
}

// ─── Get comments for a review (for the creator's view) ──────────────────────

export async function getReviewComments(reviewId: string): Promise<SlideComment[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("slide_comments")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });
  return (data ?? []) as SlideComment[];
}

// ─── Resolve a comment ───────────────────────────────────────────────────────

export async function resolveComment(commentId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("slide_comments").update({ resolved: true }).eq("id", commentId);
}

// ─── Keep comments pinned to the right slide after reordering ───────────────
// Comments are stored against a plain numeric slide_index, not a stable
// per-slide id — so dragging slide #5 to position #2 would otherwise leave
// every comment pointing at whatever slide now happens to sit at the index
// it used to. This rewrites slide_index for affected comments right after a
// drag-reorder, using the same old-index -> new-index map the editor just
// applied to the slides array itself.

export async function remapCommentSlideIndexes(
  reviewId: string,
  oldToNew: Record<number, number>
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: rows, error: fetchErr } = await admin
    .from("slide_comments")
    .select("id, slide_index")
    .eq("review_id", reviewId);
  if (fetchErr) return { error: fetchErr.message };

  const toUpdate = (rows ?? []).filter(
    (r) => oldToNew[r.slide_index] !== undefined && oldToNew[r.slide_index] !== r.slide_index
  );
  if (!toUpdate.length) return {};

  const results = await Promise.all(
    toUpdate.map((r) =>
      admin.from("slide_comments").update({ slide_index: oldToNew[r.slide_index] }).eq("id", r.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  return {};
}

// ─── Replan a single slide using a comment as direction ──────────────────────

export async function replanSlide(
  currentSlide: SlideContent,
  comment: string,
  deckContext: string
): Promise<{ slide: SlideContent | null; tokensUsed: number; error: string | null }> {
  const model = "claude-haiku-4-5-20251001";

  const prompt = `You are redesigning a single presentation slide based on reviewer feedback.

DECK CONTEXT: ${deckContext}

CURRENT SLIDE JSON:
${JSON.stringify(currentSlide, null, 2)}

REVIEWER COMMENT:
"${comment}"

Rewrite the slide to address the comment. Keep the same slide type unless the comment clearly asks for a different one. Return ONLY the updated slide as valid JSON — no markdown, no explanation. The JSON must match the exact schema of the current slide type.`;

  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const tokensUsed = msg.usage.input_tokens + msg.usage.output_tokens;
    const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const jsonStr = firstBrace >= 0 ? cleaned.slice(firstBrace) : cleaned;
    const slide = JSON.parse(jsonStr) as SlideContent;
    return { slide, tokensUsed, error: null };
  } catch (err) {
    return { slide: null, tokensUsed: 0, error: (err as Error).message };
  }
}
