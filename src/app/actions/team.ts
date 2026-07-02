"use server";

import { headers } from "next/headers";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";

export type OrgMember = {
  id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: string;
  email: string;
  full_name: string | null;
};

export type OrgInvitation = {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  invited_by_email: string | null;
  expires_at: string;
  created_at: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getCallerAndRole(
  orgId: string
): Promise<{ userId: string; role: "owner" | "admin" | "member" | "viewer" } | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .single();
  if (!data) return null;
  return { userId: user.id, role: data.role as "owner" | "admin" | "member" | "viewer" };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  // Verify the caller belongs to this org before exposing member emails.
  const caller = await getCallerAndRole(orgId);
  if (!caller) return [];

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("organization_members")
    .select("id, user_id, role, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (!members?.length) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return members.map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role as "owner" | "admin" | "member" | "viewer",
    created_at: m.created_at,
    email: profileMap.get(m.user_id)?.email ?? "",
    full_name: profileMap.get(m.user_id)?.full_name ?? null,
  }));
}

export async function listPendingInvitations(orgId: string): Promise<OrgInvitation[]> {
  // Only org members should see pending invitations.
  const caller = await getCallerAndRole(orgId);
  if (!caller) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("org_invitations")
    .select("id, email, role, invited_by, expires_at, created_at")
    .eq("organization_id", orgId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (!data?.length) return [];

  const inviterIds = [...new Set(data.map((d) => d.invited_by))];
  const { data: inviters } = await admin
    .from("profiles")
    .select("id, email")
    .in("id", inviterIds);
  const inviterMap = new Map((inviters ?? []).map((p) => [p.id, p.email]));

  return data.map((d) => ({
    id: d.id,
    email: d.email,
    role: d.role as "admin" | "member" | "viewer",
    invited_by_email: inviterMap.get(d.invited_by) ?? null,
    expires_at: d.expires_at,
    created_at: d.created_at,
  }));
}

/** Used on the public /accept-invite page to show invite details before sign-in. */
export async function getInvitationPreview(token: string): Promise<{
  org_name?: string;
  role?: string;
  email?: string;
  error?: string;
}> {
  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("org_invitations")
    .select("email, role, expires_at, accepted_at, organizations(name)")
    .eq("token", token)
    .maybeSingle();

  if (!invite) return { error: "Invalid or expired invitation link." };
  if (invite.accepted_at) return { error: "This invitation has already been accepted." };
  if (new Date(invite.expires_at) < new Date()) return { error: "This invitation has expired." };

  return {
    org_name: (invite.organizations as { name: string } | null)?.name ?? undefined,
    role: invite.role,
    email: invite.email,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function inviteMember(
  orgId: string,
  email: string,
  role: "admin" | "member" | "viewer"
): Promise<{ error?: string; inviteUrl?: string }> {
  const caller = await getCallerAndRole(orgId);
  if (!caller) return { error: "Not authenticated." };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { error: "Only owners and admins can invite members." };
  }
  if (caller.role === "admin" && role === "admin") {
    return { error: "Only the workspace owner can invite admins." };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes("@")) return { error: "Invalid email address." };

  const admin = createAdminClient();

  // Already a member?
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", cleanEmail)
    .maybeSingle();
  if (existingProfile) {
    const { data: existingMember } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();
    if (existingMember) return { error: "This person is already a member of your workspace." };
  }

  // Get org name for the email
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  // Replace any existing pending invite for this email (re-send)
  await admin
    .from("org_invitations")
    .delete()
    .eq("organization_id", orgId)
    .eq("email", cleanEmail)
    .is("accepted_at", null);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error: inviteErr } = await admin
    .from("org_invitations")
    .insert({
      organization_id: orgId,
      email: cleanEmail,
      role,
      invited_by: caller.userId,
      expires_at: expiresAt,
    })
    .select("token")
    .single();

  if (inviteErr || !invitation) {
    return { error: inviteErr?.message ?? "Failed to create invitation." };
  }

  // Add to allowed_emails so the invitee can sign up on the platform
  const { data: existingAllowed } = await admin
    .from("allowed_emails")
    .select("id")
    .eq("email", cleanEmail)
    .maybeSingle();
  if (!existingAllowed) {
    await admin.from("allowed_emails").insert({ email: cleanEmail });
  }

  // Derive the base URL from the incoming request so it always matches the
  // actual deployment (works on Vercel preview URLs, custom domains, localhost).
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (host ? `${proto}://${host}` : "https://metrik.app");
  const inviteUrl = `${appUrl}/accept-invite?token=${invitation.token}`;

  // Send invite email via Resend (if configured)
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@metrik.app";

  if (!apiKey) {
    console.warn("[inviteMember] RESEND_API_KEY is not set — skipping invite email. Invite URL:", inviteUrl);
  } else {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: cleanEmail,
          subject: `You've been invited to join ${org?.name ?? "a workspace"} on Metrik`,
          html: `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;color:#111827;">
  <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;">You're invited to Metrik</h2>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#374151;">
    You've been invited to join <strong>${org?.name ?? "a workspace"}</strong> as a
    <strong>${role}</strong>.
  </p>
  <a href="${inviteUrl}"
     style="display:inline-block;background:#4F46E5;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">
    Accept invitation
  </a>
  <p style="font-size:13px;color:#6B7280;margin-top:20px;">
    Or copy this link:<br/>
    <a href="${inviteUrl}" style="color:#4F46E5;">${inviteUrl}</a>
  </p>
  <p style="font-size:12px;color:#9CA3AF;margin-top:24px;">
    This invitation expires in 7 days. If you didn't expect this, you can ignore it.
  </p>
</div>
          `.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[inviteMember] Resend returned ${res.status}: ${body}`);
      } else {
        console.log(`[inviteMember] Invite email sent to ${cleanEmail} via ${fromEmail}`);
      }
    } catch (e) {
      console.error("[inviteMember] Failed to send invite email:", e);
      // Don't fail the whole invite if email fails — return the URL so they can copy it
    }
  }

  return { inviteUrl };
}

export async function cancelInvitation(
  orgId: string,
  invitationId: string
): Promise<{ error?: string }> {
  const caller = await getCallerAndRole(orgId);
  if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
    return { error: "Only owners and admins can cancel invitations." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("org_invitations")
    .delete()
    .eq("id", invitationId)
    .eq("organization_id", orgId);
  return error ? { error: error.message } : {};
}

export async function changeMemberRole(
  orgId: string,
  userId: string,
  newRole: "admin" | "member" | "viewer"
): Promise<{ error?: string }> {
  const caller = await getCallerAndRole(orgId);
  if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
    return { error: "Only owners and admins can change roles." };
  }
  if (caller.role === "admin" && newRole === "admin") {
    return { error: "Only the workspace owner can promote to admin." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .single();

  if (target?.role === "owner") return { error: "The owner's role cannot be changed." };
  if (caller.role === "admin" && target?.role === "admin") {
    return { error: "Admins cannot change another admin's role." };
  }

  const { error } = await admin
    .from("organization_members")
    .update({ role: newRole })
    .eq("organization_id", orgId)
    .eq("user_id", userId);
  return error ? { error: error.message } : {};
}

export async function removeMember(
  orgId: string,
  userId: string
): Promise<{ error?: string }> {
  const caller = await getCallerAndRole(orgId);
  if (!caller || (caller.role !== "owner" && caller.role !== "admin")) {
    return { error: "Only owners and admins can remove members." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .single();

  if (target?.role === "owner") return { error: "The owner cannot be removed from the workspace." };
  if (caller.role === "admin" && target?.role === "admin") {
    return { error: "Admins cannot remove other admins." };
  }

  const { error } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId);
  return error ? { error: error.message } : {};
}

// ─── Accept invite (called from /accept-invite page) ─────────────────────────

export async function acceptInvitation(
  token: string
): Promise<{ error?: string; orgId?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in to accept an invitation." };

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("org_invitations")
    .select("id, organization_id, email, role, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite) return { error: "Invalid or expired invitation link." };
  if (invite.accepted_at) return { error: "This invitation has already been accepted." };
  if (new Date(invite.expires_at) < new Date()) return { error: "This invitation has expired." };

  const userEmail = user.email?.toLowerCase().trim();
  if (userEmail !== invite.email.toLowerCase().trim()) {
    return {
      error: `This invitation was sent to ${invite.email}. Please sign in with that email address.`,
    };
  }

  // Already a member — just mark accepted and send to dashboard
  const { data: existing } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", invite.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    const { error: memberErr } = await admin
      .from("organization_members")
      .insert({
        organization_id: invite.organization_id,
        user_id: user.id,
        role: invite.role,
      });
    if (memberErr) return { error: memberErr.message };
  }

  await admin
    .from("org_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return { orgId: invite.organization_id };
}
