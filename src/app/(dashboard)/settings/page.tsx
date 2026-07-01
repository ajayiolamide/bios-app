"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit2, Check, X, Upload, ImageIcon, Link2, Loader2, CheckCircle2, AlertCircle, Tag, Palette, Plug, LayoutTemplate, Building2, AlertTriangle, Bell, Users, Shield, UserMinus, Mail, Copy } from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import {
  getBrandSettings, saveBrandSettings,
  getReportTemplates, createReportTemplate,
  updateReportTemplate, deleteReportTemplate,
  seedDefaultTemplates,
} from "@/app/actions/settings";
import {
  getMixpanelSettings,
  saveMixpanelSettings,
  testMixpanelConnection,
} from "@/app/actions/mixpanel";
import {
  getAmplitudeSettings,
  saveAmplitudeSettings,
  testAmplitudeConnection,
} from "@/app/actions/amplitude";
import { updateProductGoalLabel, renameOrganization, removeOrganization } from "@/app/actions/organizations";
import {
  listOrgMembers, listPendingInvitations, inviteMember,
  cancelInvitation, changeMemberRole, removeMember,
} from "@/app/actions/team";
import type { OrgMember, OrgInvitation } from "@/app/actions/team";
import { createClient } from "@/lib/supabase/client";
import type { BrandSettings, ReportTemplate } from "@/types/database";

function Section({ title, description, icon: Icon, children }: {
  title: string; description?: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-start gap-2.5">
        {Icon && (
          <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
            <Icon className="h-4 w-4 text-indigo-500" />
          </div>
        )}
        <div>
          <h2 className="font-semibold text-base">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="border-t pt-4">{children}</div>
    </div>
  );
}

const DESIGN_THEMES = [
  { id: "brand", label: "Brand", desc: "Brand color cover, white content slides" },
  { id: "midnight", label: "Midnight", desc: "Dark navy throughout" },
  { id: "clean", label: "Clean", desc: "All-white, typography-first" },
] as const;

const SETTINGS_TABS = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "terminology", label: "Terminology", icon: Tag },
  { id: "brand", label: "Brand", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "templates", label: "Report templates", icon: LayoutTemplate },
] as const;
type SettingsTab = typeof SETTINGS_TABS[number]["id"];

function BrandPreview({ companyName, primaryColor, secondaryColor, logoUrl }: {
  companyName: string; primaryColor: string; secondaryColor: string; logoUrl: string;
}) {
  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Slide header */}
      <div className="px-5 py-3 flex items-center gap-3" style={{ backgroundColor: primaryColor }}>
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="h-7 w-auto object-contain" />
        ) : (
          <div className="h-7 w-7 rounded bg-white/20 flex items-center justify-center text-white text-xs font-bold">
            {(companyName || "Co").slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="text-white font-semibold text-sm">{companyName || "Your Company"}</span>
        <span className="ml-auto text-white/60 text-xs">Monthly Report · June 2026</span>
      </div>
      {/* Slide body */}
      <div className="bg-white p-5 space-y-3">
        <div className="h-2 rounded-full w-2/3" style={{ backgroundColor: primaryColor }} />
        <div className="h-2 rounded-full w-1/2 opacity-40" style={{ backgroundColor: primaryColor }} />
        <div className="grid grid-cols-3 gap-2 mt-3">
          {["KPI 1", "KPI 2", "KPI 3"].map((k) => (
            <div key={k} className="rounded-lg p-3 text-center" style={{ backgroundColor: secondaryColor + "33" }}>
              <div className="text-lg font-bold" style={{ color: primaryColor }}>—</div>
              <div className="text-xs mt-0.5" style={{ color: primaryColor + "99" }}>{k}</div>
            </div>
          ))}
        </div>
        <div className="h-1.5 rounded-full w-full opacity-20" style={{ backgroundColor: primaryColor }} />
        <div className="h-1.5 rounded-full w-4/5 opacity-20" style={{ backgroundColor: primaryColor }} />
      </div>
      {/* Footer */}
      <div className="px-5 py-2 flex items-center justify-between" style={{ backgroundColor: secondaryColor + "33" }}>
        <span className="text-xs" style={{ color: primaryColor }}>Confidential</span>
        <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: primaryColor }} />
      </div>
    </div>
  );
}

function TemplateRow({ t, onSaved, onDeleted }: {
  t: ReportTemplate; onSaved: () => void; onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [instructions, setInstructions] = useState(t.instructions);
  const [slideHint, setSlideHint] = useState(t.slide_hint);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await updateReportTemplate(t.id, { name, instructions, slide_hint: slideHint });
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  if (editing) {
    return (
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3 my-2">
        <input
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name"
        />
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)}
          placeholder="Instructions for the AI — describe the audience, depth, tone, and what to focus on"
        />
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground shrink-0">Target slides:</label>
          <input type="number" min={3} max={30}
            className="w-20 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={slideHint} onChange={(e) => setSlideHint(Number(e.target.value))}
          />
          <div className="flex gap-2 ml-auto">
            <button onClick={() => setEditing(false)} className="p-1.5 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
              <Check className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm">{t.name}</p>
          <span className="text-xs text-muted-foreground">· {t.slide_hint} slides</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.instructions}</p>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Edit2 className="h-3.5 w-3.5" /></button>
        <button onClick={async () => { if (!confirm(`Delete "${t.name}"?`)) return; await deleteReportTemplate(t.id); onDeleted(); }}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { currentOrg, setCurrentOrg, removeOrg } = useOrg();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("terminology");
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);

  // Organization — renaming the workspace itself (shown in the org switcher
  // and sidebar everywhere), plus the danger-zone delete flow.
  const [orgName, setOrgName] = useState("");
  const [orgNameSaving, setOrgNameSaving] = useState(false);
  const [orgNameSaved, setOrgNameSaved] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Terminology — what this org calls the sub-goal layer under a Business
  // Goal. Seeded straight from currentOrg (no extra fetch needed) and pushed
  // back into the same org-context object on save so every page reading
  // currentOrg.product_goal_label updates immediately, no reload required.
  const [productGoalLabel, setProductGoalLabel] = useState("Product Goal");
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");
  const [secondaryColor, setSecondaryColor] = useState("#a5b4fc");
  // Which color/layout theme generated decks use — moved here from the
  // Reports page, where it was a 3-up grid of large color-swatch cards that
  // made the "Report setup" step look bigger than it needed to be for a
  // setting most people pick once and never touch again. Lives with the
  // rest of the brand settings it visually depends on (primary/secondary
  // color + logo).
  const [designTheme, setDesignTheme] = useState("brand");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [slackDigestEnabled, setSlackDigestEnabled] = useState(false);
  const [slackDigestCadence, setSlackDigestCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [digestSections, setDigestSections] = useState({ goals: true, features: true, attention: true });
  const [pmStatusAlertsEnabled, setPmStatusAlertsEnabled] = useState(true);
  const [pmWeeklyDigestEnabled, setPmWeeklyDigestEnabled] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  // Bumped on every re-upload to bust the browser's <img> cache for the
  // preview only — kept separate from logoUrl so the cache-busting query
  // string never ends up in what gets saved to brand_settings.logo_url.
  // (It used to: pptxgenjs reads the image extension off the end of the
  // path string, so a trailing "?t=..." made it silently fail to embed the
  // logo in generated decks, even though the upload itself worked fine.)
  const [logoCacheBust, setLogoCacheBust] = useState(0);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [newSlideHint, setNewSlideHint] = useState(8);
  const [newSaving, setNewSaving] = useState(false);

  // Mixpanel
  const [mpUsername, setMpUsername] = useState("");
  const [mpApiSecret, setMpApiSecret] = useState("");
  const [mpProjectId, setMpProjectId] = useState("");
  const [mpRegion, setMpRegion] = useState<"US" | "EU">("US");
  const [mpConnected, setMpConnected] = useState(false);
  const [mpSaving, setMpSaving] = useState(false);
  const [mpTesting, setMpTesting] = useState(false);
  const [mpStatus, setMpStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Amplitude
  const [ampApiKey, setAmpApiKey] = useState("");
  const [ampSecretKey, setAmpSecretKey] = useState("");
  const [ampRegion, setAmpRegion] = useState<"US" | "EU">("US");
  const [ampConnected, setAmpConnected] = useState(false);
  const [ampSaving, setAmpSaving] = useState(false);
  const [ampTesting, setAmpTesting] = useState(false);
  const [ampStatus, setAmpStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Team
  const [teamMembers, setTeamMembers] = useState<OrgMember[]>([]);
  const [teamInvitations, setTeamInvitations] = useState<OrgInvitation[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "viewer">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ error?: string; url?: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentOrg) return;
    await seedDefaultTemplates(currentOrg.id);
    const [b, t, mp, amp] = await Promise.all([
      getBrandSettings(currentOrg.id),
      getReportTemplates(currentOrg.id),
      getMixpanelSettings(currentOrg.id),
      getAmplitudeSettings(currentOrg.id),
    ]);
    setTemplates(t);
    if (b) {
      setCompanyName(b.company_name ?? "");
      setPrimaryColor(b.primary_color ?? "#6366f1");
      setSecondaryColor((b as BrandSettings & { secondary_color?: string }).secondary_color ?? "#a5b4fc");
      setSlackWebhook(b.slack_webhook ?? "");
      setSlackDigestEnabled((b as BrandSettings & { slack_digest_enabled?: boolean }).slack_digest_enabled ?? false);
      setSlackDigestCadence(((b as BrandSettings & { slack_digest_cadence?: string }).slack_digest_cadence ?? "weekly") as "daily" | "weekly" | "monthly");
      const ds = (b as BrandSettings & { digest_sections?: { goals?: boolean; features?: boolean; attention?: boolean } }).digest_sections ?? {};
      setDigestSections({ goals: ds.goals !== false, features: ds.features !== false, attention: ds.attention !== false });
      setPmStatusAlertsEnabled((b as BrandSettings & { pm_status_alerts_enabled?: boolean }).pm_status_alerts_enabled ?? true);
      setPmWeeklyDigestEnabled((b as BrandSettings & { pm_weekly_digest_enabled?: boolean }).pm_weekly_digest_enabled ?? true);
      setLogoUrl(b.logo_url ?? "");
      setDesignTheme((b as BrandSettings & { design_theme?: string }).design_theme ?? "brand");
    }
    if (mp.connected && mp.settings) {
      setMpUsername(mp.settings.username ?? "");
      setMpApiSecret(mp.settings.api_secret);
      setMpProjectId(mp.settings.project_id ?? "");
      setMpRegion(mp.settings.data_region);
      setMpConnected(true);
    }
    if (amp.connected && amp.settings) {
      setAmpApiKey(amp.settings.api_key);
      setAmpSecretKey(amp.settings.secret_key);
      setAmpRegion(amp.settings.data_region);
      setAmpConnected(true);
    }
  }, [currentOrg]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (currentOrg) setProductGoalLabel(currentOrg.product_goal_label?.trim() || "Product Goal");
  }, [currentOrg]);

  useEffect(() => {
    if (currentOrg) setOrgName(currentOrg.name ?? "");
  }, [currentOrg]);

  // Load team data when the Team tab becomes active
  useEffect(() => {
    if (activeTab !== "team" || !currentOrg) return;
    setTeamLoading(true);
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
    Promise.all([
      listOrgMembers(currentOrg.id),
      listPendingInvitations(currentOrg.id),
    ]).then(([members, invitations]) => {
      setTeamMembers(members);
      setTeamInvitations(invitations);
      setTeamLoading(false);
    });
  }, [activeTab, currentOrg]);

  // Derive current user's role from members list
  useEffect(() => {
    if (!currentUserId || !teamMembers.length) return;
    const me = teamMembers.find((m) => m.user_id === currentUserId);
    setCurrentUserRole(me?.role ?? null);
  }, [currentUserId, teamMembers]);

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrg || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteResult(null);
    const res = await inviteMember(currentOrg.id, inviteEmail.trim(), inviteRole);
    if (res.error) {
      setInviteResult({ error: res.error });
    } else {
      setInviteResult({ url: res.inviteUrl });
      setInviteEmail("");
      // Refresh lists
      const [members, invitations] = await Promise.all([
        listOrgMembers(currentOrg.id),
        listPendingInvitations(currentOrg.id),
      ]);
      setTeamMembers(members);
      setTeamInvitations(invitations);
    }
    setInviting(false);
  }

  async function handleCancelInvite(invitationId: string) {
    if (!currentOrg) return;
    await cancelInvitation(currentOrg.id, invitationId);
    setTeamInvitations((prev) => prev.filter((i) => i.id !== invitationId));
  }

  async function handleChangeRole(userId: string, newRole: "admin" | "member" | "viewer") {
    if (!currentOrg) return;
    const res = await changeMemberRole(currentOrg.id, userId, newRole);
    if (res.error) { alert(res.error); return; }
    setTeamMembers((prev) => prev.map((m) => m.user_id === userId ? { ...m, role: newRole } : m));
  }

  async function handleRemoveMember(userId: string, email: string) {
    if (!currentOrg) return;
    if (!confirm(`Remove ${email} from this workspace?`)) return;
    const res = await removeMember(currentOrg.id, userId);
    if (res.error) { alert(res.error); return; }
    setTeamMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  async function saveOrgName(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrg) return;
    const trimmed = orgName.trim();
    if (!trimmed) return;
    setOrgNameSaving(true);
    const result = await renameOrganization(currentOrg.id, trimmed);
    setOrgNameSaving(false);
    if (!result.error) {
      setCurrentOrg({ ...currentOrg, name: trimmed });
      setOrgNameSaved(true);
      setTimeout(() => setOrgNameSaved(false), 2000);
    }
  }

  async function handleDeleteOrg() {
    if (!currentOrg || deleteConfirmText !== currentOrg.name) return;
    setDeleting(true);
    setDeleteError(null);
    const { error } = await removeOrganization(currentOrg.id);
    if (error) {
      setDeleting(false);
      setDeleteError(error);
      return;
    }
    const next = removeOrg(currentOrg.id);
    setDeleting(false);
    if (!next) router.push("/create-workspace");
    else router.refresh();
  }

  async function saveProductGoalLabel(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrg) return;
    const trimmed = productGoalLabel.trim();
    if (!trimmed) return;
    setLabelSaving(true);
    const result = await updateProductGoalLabel(currentOrg.id, trimmed);
    setLabelSaving(false);
    if (!result.error) {
      setCurrentOrg({ ...currentOrg, product_goal_label: trimmed });
      setLabelSaved(true);
      setTimeout(() => setLabelSaved(false), 2000);
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;
    setLogoUploading(true);
    setLogoError(null);
    const supabase = createClient();
    const ext = file.name.split(".").pop();
    // A fixed path (e.g. "<org>/logo.png") reused on every upload keeps the
    // exact same public URL forever, with `upsert: true` swapping the bytes
    // underneath it. Supabase Storage serves that URL through a CDN with its
    // own cache lifetime, so re-uploading a logo doesn't reliably invalidate
    // copies already cached at that URL — the browser preview here, the
    // Reports preview, and pptxgenjs's own server-side fetch when building a
    // deck can all keep serving the OLD image bytes for a while even though
    // the upload itself succeeded. A query-string cache-buster would fix the
    // browser cases but breaks pptxgenjs (it reads the image type off the
    // literal end of the URL). Using a unique filename per upload sidesteps
    // all of that at once: every upload gets a brand-new URL, so there's
    // nothing stale to ever be served, anywhere — without needing any
    // cache-busting trick at all.
    const path = `${currentOrg.id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) {
      setLogoError(
        error.message?.toLowerCase().includes("bucket not found")
          ? "Upload storage isn't set up yet — run the latest database migration, then try again."
          : `Upload failed: ${error.message}`
      );
    } else {
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      setLogoCacheBust(Date.now());
    }
    setLogoUploading(false);
  }

  async function saveBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrg) return;
    setBrandSaving(true);
    await saveBrandSettings(currentOrg.id, {
      company_name: companyName,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      slack_webhook: slackWebhook,
      logo_url: logoUrl,
      design_theme: designTheme,
    });
    setBrandSaving(false);
    setBrandSaved(true);
    setTimeout(() => setBrandSaved(false), 2000);
  }

  async function saveNotifications(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrg) return;
    setNotifSaving(true);
    await saveBrandSettings(currentOrg.id, {
      company_name: companyName,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      slack_webhook: slackWebhook,
      slack_digest_enabled: slackDigestEnabled,
      slack_digest_cadence: slackDigestCadence,
      digest_sections: digestSections,
      pm_status_alerts_enabled: pmStatusAlertsEnabled,
      pm_weekly_digest_enabled: pmWeeklyDigestEnabled,
    });
    setNotifSaving(false);
    setNotifSaved(true);
    setTimeout(() => setNotifSaved(false), 2000);
  }

  async function saveMixpanel() {
    if (!currentOrg) return;
    setMpSaving(true);
    setMpStatus(null);
    await saveMixpanelSettings(currentOrg.id, {
      username: mpUsername,
      api_secret: mpApiSecret,
      project_id: mpProjectId,
      data_region: mpRegion,
    });
    setMpConnected(!!mpApiSecret);
    setMpSaving(false);
    setMpStatus({ ok: true, msg: "Saved." });
    setTimeout(() => setMpStatus(null), 2000);
  }

  async function testMixpanel() {
    if (!currentOrg) return;
    setMpTesting(true);
    setMpStatus(null);
    const saveResult = await saveMixpanelSettings(currentOrg.id, {
      username: mpUsername,
      api_secret: mpApiSecret,
      project_id: mpProjectId,
      data_region: mpRegion,
    });
    if (saveResult.error) {
      setMpTesting(false);
      setMpStatus({ ok: false, msg: `Save failed: ${saveResult.error} — did you run migration 011 in Supabase?` });
      return;
    }
    const result = await testMixpanelConnection(currentOrg.id);
    setMpTesting(false);
    setMpConnected(result.ok);
    setMpStatus({ ok: result.ok, msg: result.ok ? "Connected ✓" : result.error ?? "Connection failed" });
  }

  async function saveAmplitude() {
    if (!currentOrg) return;
    setAmpSaving(true);
    setAmpStatus(null);
    await saveAmplitudeSettings(currentOrg.id, {
      api_key: ampApiKey,
      secret_key: ampSecretKey,
      data_region: ampRegion,
    });
    setAmpConnected(!!ampApiKey && !!ampSecretKey);
    setAmpSaving(false);
    setAmpStatus({ ok: true, msg: "Saved." });
    setTimeout(() => setAmpStatus(null), 2000);
  }

  async function testAmplitude() {
    if (!currentOrg) return;
    setAmpTesting(true);
    setAmpStatus(null);
    const saveResult = await saveAmplitudeSettings(currentOrg.id, {
      api_key: ampApiKey,
      secret_key: ampSecretKey,
      data_region: ampRegion,
    });
    if (saveResult.error) {
      setAmpTesting(false);
      setAmpStatus({ ok: false, msg: `Save failed: ${saveResult.error} — did you run migration 023 in Supabase?` });
      return;
    }
    const result = await testAmplitudeConnection(currentOrg.id);
    setAmpTesting(false);
    setAmpConnected(result.ok);
    setAmpStatus({ ok: result.ok, msg: result.ok ? "Connected ✓" : result.error ?? "Connection failed" });
  }

  async function addTemplate() {
    if (!currentOrg || !newName.trim() || !newInstructions.trim()) return;
    setNewSaving(true);
    await createReportTemplate(currentOrg.id, { name: newName, instructions: newInstructions, slide_hint: newSlideHint });
    setNewSaving(false);
    setShowNew(false);
    setNewName(""); setNewInstructions(""); setNewSlideHint(8);
    loadData();
  }

  if (!currentOrg) return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">No organization selected.</div>
  );

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Brand, report templates, and integrations</p>
      </div>

      <div className="flex gap-8">
        {/* Section nav */}
        <nav className="w-48 shrink-0 space-y-1 sticky top-6 self-start">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  active ? "bg-indigo-50 text-indigo-700" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-indigo-500" : "text-muted-foreground"}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Active section content */}
        <div className="flex-1 min-w-0 space-y-6">

      {activeTab === "organization" && (
      <>
      <Section title="Organization" icon={Building2} description="The workspace name shown in the switcher, sidebar, and everywhere else in the app.">
        <form onSubmit={saveOrgName} className="space-y-3 max-w-sm">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Company name</label>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Mycover"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={orgNameSaving || !orgName.trim()}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              {orgNameSaving ? "Saving…" : "Save"}
            </button>
            {orgNameSaved && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
        </form>
      </Section>

      <div className="rounded-xl border border-red-200 bg-red-50/40 p-6 space-y-4">
        <div className="flex items-start gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </div>
          <div>
            <h2 className="font-semibold text-base text-red-900">Danger zone</h2>
            <p className="text-sm text-red-700/80 mt-0.5">
              Permanently delete this organization — all goals, features, events, reports, and connected integrations go with it. This can&apos;t be undone.
            </p>
          </div>
        </div>
        <div className="border-t border-red-200 pt-4 space-y-2.5 max-w-sm">
          <label className="text-sm font-medium text-red-900">
            Type <span className="font-mono bg-red-100 px-1 rounded">{currentOrg?.name}</span> to confirm
          </label>
          <input
            value={deleteConfirmText}
            onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError(null); }}
            placeholder={currentOrg?.name ?? ""}
            className="w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
          <button
            onClick={handleDeleteOrg}
            disabled={deleting || deleteConfirmText !== currentOrg?.name}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3.5 py-1.5 rounded-md transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting…" : "Delete this organization"}
          </button>
        </div>
      </div>
      </>
      )}

      {activeTab === "terminology" && (
      <Section title="Terminology" icon={Tag} description="Rename what the app calls the sub-goal layer under a Business Goal.">
        <form onSubmit={saveProductGoalLabel} className="space-y-3 max-w-sm">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">What do you call a Product Goal?</label>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Product Goal, Initiative, Workstream, OKR"
              value={productGoalLabel}
              onChange={(e) => setProductGoalLabel(e.target.value)}
              maxLength={40}
            />
            <p className="text-xs text-muted-foreground">Shows up everywhere this used to say &ldquo;Product Goal(s)&rdquo; — the Goals page, the Overview dashboard, etc.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={labelSaving || !productGoalLabel.trim()}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              {labelSaving ? "Saving…" : "Save"}
            </button>
            {labelSaved && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
        </form>
      </Section>
      )}

      {activeTab === "brand" && (
      <Section title="Brand" icon={Palette} description="Applied to all generated reports and decks">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={saveBrand} className="space-y-4">
            {/* Logo */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Company logo</label>
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? (
                    <img src={logoCacheBust ? `${logoUrl}?v=${logoCacheBust}` : logoUrl} alt="logo" className="h-full w-full object-contain p-1" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    disabled={logoUploading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm hover:bg-muted transition-colors disabled:opacity-50">
                    <Upload className="h-3.5 w-3.5" />
                    {logoUploading ? "Uploading…" : "Upload logo"}
                  </button>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG or SVG — max 2MB</p>
                  {logoError && <p className="text-xs text-red-500 mt-1 max-w-xs">{logoError}</p>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
              </div>
            </div>

            {/* Company name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Company name</label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. MyCover" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Primary colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" className="h-9 w-12 rounded-md border cursor-pointer"
                    value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                  <span className="text-xs text-muted-foreground font-mono">{primaryColor}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Secondary colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" className="h-9 w-12 rounded-md border cursor-pointer"
                    value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
                  <span className="text-xs text-muted-foreground font-mono">{secondaryColor}</span>
                </div>
              </div>
            </div>

            {/* Design theme — which color/layout style generated decks use.
                Compact pill row instead of a big 3-up card grid: this is a
                pick-once-and-forget setting, not something that needs a
                large visual every time someone opens report settings. */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Report deck theme</label>
              <div className="flex gap-2">
                {DESIGN_THEMES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.desc}
                    onClick={() => setDesignTheme(t.id)}
                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                      designTheme === t.id ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        t.id === "midnight" ? "bg-slate-900" : t.id === "clean" ? "bg-white border border-gray-300" : "bg-indigo-600"
                      }`}
                    />
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{DESIGN_THEMES.find(t => t.id === designTheme)?.desc}</p>
            </div>

            {/* Slack webhook — needed here so reports post to Slack */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Slack webhook <span className="text-muted-foreground">(optional)</span></label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="https://hooks.slack.com/services/..." value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Reports are posted here. Notification settings are under the Notifications tab.</p>
            </div>

            <button type="submit" disabled={brandSaving}
              className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {brandSaved ? "Saved ✓" : brandSaving ? "Saving…" : "Save brand settings"}
            </button>
          </form>

          {/* Live preview */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Preview</p>
            <BrandPreview
              companyName={companyName}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              logoUrl={logoUrl ? (logoCacheBust ? `${logoUrl}?v=${logoCacheBust}` : logoUrl) : ""}
            />
          </div>
        </div>
      </Section>
      )}

      {activeTab === "notifications" && (
      <form onSubmit={saveNotifications} className="space-y-6">

        {/* ── Slack webhook prereq ─────────────────────────────────────────── */}
        {!slackWebhook && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3">
            <Bell className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Slack webhook not set</p>
              <p className="text-xs text-amber-700 mt-0.5">
                All notifications below send via Slack. Add your webhook URL in the <strong>Brand</strong> tab first.
              </p>
            </div>
          </div>
        )}

        {/* ── Goal & Product Digest ─────────────────────────────────────────── */}
        <Section title="Goal & Product Digest" icon={Bell}
          description="A scheduled summary of your business goals and product goal health, sent to the whole team.">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable digest</p>
                <p className="text-xs text-muted-foreground mt-0.5">Posts a goal progress summary to your Slack channel</p>
              </div>
              <button
                type="button"
                disabled={!slackWebhook}
                onClick={() => setSlackDigestEnabled(!slackDigestEnabled)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-40 ${slackDigestEnabled ? "bg-indigo-600" : "bg-gray-200"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${slackDigestEnabled ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>

            {slackDigestEnabled && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Frequency</p>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { value: "daily",   label: "Every morning" },
                      { value: "weekly",  label: "Every Monday"  },
                      { value: "monthly", label: "1st of month"  },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSlackDigestCadence(value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${slackDigestCadence === value ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-500 hover:text-gray-800"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">What to include in the digest</p>
                  <div className="space-y-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                    {([
                      { key: "goals" as const,     label: "Business Goals & KPI actuals",  desc: "Goal progress, KPI vs target with real values" },
                      { key: "features" as const,  label: "Features in flight",             desc: "Status of active features (deployed, in dev, etc.)" },
                      { key: "attention" as const, label: "Needs attention",                desc: "Unwired KPIs, goals missing products goals, etc." },
                    ]).map(({ key, label, desc }) => (
                      <div key={key} className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-gray-700">{label}</p>
                          <p className="text-[11px] text-muted-foreground">{desc}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDigestSections(prev => ({ ...prev, [key]: !prev[key] }))}
                          className={`mt-0.5 relative inline-flex h-4 w-8 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${digestSections[key] ? "bg-indigo-600" : "bg-gray-200"}`}
                        >
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ${digestSections[key] ? "translate-x-4" : "translate-x-0"}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Alerts that fired in the last 24h are always included when present.</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* ── PM Feature Notifications ──────────────────────────────────────── */}
        <Section title="PM Feature Notifications" icon={Bell}
          description="Targeted notifications to the PM assigned to each feature — separate from the team-wide digest above.">
          <div className="space-y-5">

            {/* Status change alert */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Status change alert</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Whenever a feature's status changes, Slack pings the assigned PM handle immediately (e.g. @jane).
                </p>
              </div>
              <button
                type="button"
                disabled={!slackWebhook}
                onClick={() => setPmStatusAlertsEnabled(!pmStatusAlertsEnabled)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-40 ${pmStatusAlertsEnabled ? "bg-indigo-600" : "bg-gray-200"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${pmStatusAlertsEnabled ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>

            <div className="border-t" />

            {/* Weekly PM digest */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Weekly PM digest</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every Monday at 9am, each PM gets a Slack summary of their assigned features — status, KPI count, guardrails, and launch date.
                </p>
              </div>
              <button
                type="button"
                disabled={!slackWebhook}
                onClick={() => setPmWeeklyDigestEnabled(!pmWeeklyDigestEnabled)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-40 ${pmWeeklyDigestEnabled ? "bg-indigo-600" : "bg-gray-200"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${pmWeeklyDigestEnabled ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>

            <p className="text-xs text-muted-foreground bg-gray-50 rounded-lg px-3 py-2">
              PM handles are set per feature on the Feature Metrics page. Make sure each feature has a handle like <span className="font-mono">@jane</span> for these to work.
            </p>
          </div>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={notifSaving}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
          >
            {notifSaving ? "Saving…" : "Save notification settings"}
          </button>
          {notifSaved && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </form>
      )}

      {activeTab === "integrations" && (
      <>
      {/* Mixpanel */}
      <Section title="Mixpanel" icon={Plug} description="Connect your Mixpanel project to pull live event counts into Business Goals health tracking.">
        <div className="space-y-4">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${mpConnected ? "bg-emerald-400" : "bg-gray-300"}`} />
            <span className="text-sm text-muted-foreground">
              {mpConnected ? "Connected" : "Not connected"}
            </span>
          </div>

          <div className="space-y-3">
            {/* Service Account Username */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Service Account Username
                <a
                  href="https://mixpanel.com/settings/project/serviceaccounts"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-xs text-indigo-500 hover:underline inline-flex items-center gap-0.5"
                >
                  <Link2 size={10} /> Manage Service Accounts
                </a>
              </label>
              <input
                type="text"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                placeholder="someone.abc123.mp-service-account"
                value={mpUsername}
                onChange={(e) => setMpUsername(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Mixpanel → Project Settings → Service Accounts → Username column
              </p>
            </div>

            {/* Service Account Secret */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service Account Secret</label>
              <input
                type="password"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                placeholder="••••••••••••••••••••••••••••••••"
                value={mpApiSecret}
                onChange={(e) => setMpApiSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The secret shown once when you create the Service Account
              </p>
            </div>

            {/* Project ID + Region */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Project ID <span className="text-muted-foreground font-normal">(required for Service Accounts)</span></label>
                <input
                  type="text"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="12345678"
                  value={mpProjectId}
                  onChange={(e) => setMpProjectId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mixpanel → Project Settings → Overview → Project ID
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data region</label>
                <select
                  value={mpRegion}
                  onChange={(e) => setMpRegion(e.target.value as "US" | "EU")}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="US">US (default)</option>
                  <option value="EU">EU residency</option>
                </select>
              </div>
            </div>
          </div>

          {/* Status message */}
          {mpStatus && (
            <div className={`flex items-center gap-2 text-sm ${mpStatus.ok ? "text-emerald-600" : "text-red-500"}`}>
              {mpStatus.ok
                ? <CheckCircle2 size={14} />
                : <AlertCircle size={14} />}
              {mpStatus.msg}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={testMixpanel}
              disabled={!mpApiSecret || !mpUsername || mpTesting || mpSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm hover:bg-muted transition-colors disabled:opacity-40"
            >
              {mpTesting && <Loader2 size={13} className="animate-spin" />}
              Test connection
            </button>
            <button
              onClick={saveMixpanel}
              disabled={!mpApiSecret || mpSaving || mpTesting}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {mpSaving && <Loader2 size={13} className="animate-spin" />}
              Save
            </button>
            {mpConnected && (
              <button
                onClick={async () => {
                  if (!currentOrg) return;
                  await saveMixpanelSettings(currentOrg.id, { username: "", api_secret: "" });
                  setMpUsername(""); setMpApiSecret(""); setMpConnected(false);
                }}
                className="text-sm text-red-400 hover:text-red-600 transition-colors ml-auto"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* Amplitude */}
      <Section title="Amplitude" icon={Plug} description="Connect your Amplitude project to pull live event counts into Business Goals health tracking — same role as the Mixpanel connector above, for orgs using Amplitude instead.">
        <div className="space-y-4">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${ampConnected ? "bg-emerald-400" : "bg-gray-300"}`} />
            <span className="text-sm text-muted-foreground">
              {ampConnected ? "Connected" : "Not connected"}
            </span>
          </div>

          <div className="space-y-3">
            {/* API Key */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                API Key
                <a
                  href="https://app.amplitude.com/settings/projects"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-xs text-indigo-500 hover:underline inline-flex items-center gap-0.5"
                >
                  <Link2 size={10} /> Manage Projects
                </a>
              </label>
              <input
                type="text"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                placeholder="a1b2c3d4e5f6..."
                value={ampApiKey}
                onChange={(e) => setAmpApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Amplitude → Org Settings → Projects → your project → General
              </p>
            </div>

            {/* Secret Key */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Secret Key</label>
              <input
                type="password"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                placeholder="••••••••••••••••••••••••••••••••"
                value={ampSecretKey}
                onChange={(e) => setAmpSecretKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Same Projects page as the API Key, just below it
              </p>
            </div>

            {/* Region */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Data region</label>
              <select
                value={ampRegion}
                onChange={(e) => setAmpRegion(e.target.value as "US" | "EU")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="US">US (default)</option>
                <option value="EU">EU residency</option>
              </select>
            </div>
          </div>

          {/* Status message */}
          {ampStatus && (
            <div className={`flex items-center gap-2 text-sm ${ampStatus.ok ? "text-emerald-600" : "text-red-500"}`}>
              {ampStatus.ok
                ? <CheckCircle2 size={14} />
                : <AlertCircle size={14} />}
              {ampStatus.msg}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={testAmplitude}
              disabled={!ampApiKey || !ampSecretKey || ampTesting || ampSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-md border text-sm hover:bg-muted transition-colors disabled:opacity-40"
            >
              {ampTesting && <Loader2 size={13} className="animate-spin" />}
              Test connection
            </button>
            <button
              onClick={saveAmplitude}
              disabled={!ampApiKey || !ampSecretKey || ampSaving || ampTesting}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {ampSaving && <Loader2 size={13} className="animate-spin" />}
              Save
            </button>
            {ampConnected && (
              <button
                onClick={async () => {
                  if (!currentOrg) return;
                  await saveAmplitudeSettings(currentOrg.id, { api_key: "", secret_key: "" });
                  setAmpApiKey(""); setAmpSecretKey(""); setAmpConnected(false);
                }}
                className="text-sm text-red-400 hover:text-red-600 transition-colors ml-auto"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </Section>
      </>
      )}

      {activeTab === "team" && (
      <div className="space-y-6">

        {/* ── Invite form (owners + admins only) ───────────────────────────── */}
        {(currentUserRole === "owner" || currentUserRole === "admin") && (
        <Section title="Invite a team member" icon={Mail}
          description="Send an invitation link — they'll be added to this workspace when they accept.">
          <form onSubmit={handleSendInvite} className="space-y-4">
            <div className="flex gap-3">
              <input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "member" | "viewer")}
                className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {currentUserRole === "owner" && <option value="admin">Admin</option>}
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {inviting && <Loader2 size={13} className="animate-spin" />}
                {inviting ? "Sending…" : "Send invite"}
              </button>
            </div>

            {/* Role descriptions */}
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              {currentUserRole === "owner" && (
                <div className="rounded-lg border px-3 py-2 bg-slate-50">
                  <p className="font-medium text-foreground mb-0.5">Admin</p>
                  <p>Can invite members, manage the workspace</p>
                </div>
              )}
              <div className="rounded-lg border px-3 py-2 bg-slate-50">
                <p className="font-medium text-foreground mb-0.5">Member</p>
                <p>Full access to view and edit data</p>
              </div>
              <div className="rounded-lg border px-3 py-2 bg-slate-50">
                <p className="font-medium text-foreground mb-0.5">Viewer</p>
                <p>Read-only access to the workspace</p>
              </div>
            </div>

            {/* Result feedback */}
            {inviteResult?.error && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {inviteResult.error}
              </div>
            )}
            {inviteResult?.url && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                  <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                  Invitation sent! Share this link if email isn&apos;t configured:
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2">
                  <span className="flex-1 text-xs text-muted-foreground truncate font-mono">{inviteResult.url}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(inviteResult.url!)}
                    className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Copy link"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            )}
          </form>
        </Section>
        )}

        {/* ── Members list ─────────────────────────────────────────────────── */}
        <Section title="Members" icon={Users}
          description={`${teamMembers.length} member${teamMembers.length === 1 ? "" : "s"} in this workspace`}>
          {teamLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading members…
            </div>
          ) : (
            <div className="space-y-1">
              {teamMembers.map((member) => {
                const isMe = member.user_id === currentUserId;
                const canManage =
                  (currentUserRole === "owner" || currentUserRole === "admin") &&
                  !isMe &&
                  member.role !== "owner" &&
                  !(currentUserRole === "admin" && member.role === "admin");
                return (
                  <div key={member.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                    {/* Avatar initial */}
                    <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold shrink-0">
                      {(member.full_name || member.email || "?")[0].toUpperCase()}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.full_name || member.email}
                        {isMe && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                      </p>
                      {member.full_name && (
                        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      )}
                    </div>
                    {/* Role — dropdown for manageable members, badge otherwise */}
                    {canManage ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleChangeRole(member.user_id, e.target.value as "admin" | "member" | "viewer")}
                        className="text-xs rounded-md border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {currentUserRole === "owner" && <option value="admin">Admin</option>}
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        member.role === "owner"
                          ? "bg-amber-100 text-amber-700"
                          : member.role === "admin"
                          ? "bg-indigo-100 text-indigo-700"
                          : member.role === "viewer"
                          ? "bg-slate-100 text-slate-600"
                          : "bg-emerald-100 text-emerald-700"
                      }`}>
                        {member.role === "owner" && <Shield size={10} className="inline mr-0.5" />}
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </span>
                    )}
                    {/* Remove button */}
                    {canManage && (
                      <button
                        onClick={() => handleRemoveMember(member.user_id, member.email)}
                        className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove member"
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ── Pending invitations ───────────────────────────────────────────── */}
        {teamInvitations.length > 0 && (
        <Section title="Pending invitations" icon={Mail}
          description="These people have been invited but haven't accepted yet.">
          <div className="space-y-1">
            {teamInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                <div className="h-8 w-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm shrink-0">
                  <Mail size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(inv.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                  {inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                </span>
                {(currentUserRole === "owner" || currentUserRole === "admin") && (
                  <button
                    onClick={() => handleCancelInvite(inv.id)}
                    className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Cancel invitation"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
        )}

      </div>
      )}

      {activeTab === "templates" && (
      <Section title="Report templates" icon={LayoutTemplate}
        description="Each template generates one deck. Edit the instructions to tell the AI what to focus on for each audience.">
        {templates.map((t) => (
          <TemplateRow key={t.id} t={t} onSaved={loadData} onDeleted={loadData} />
        ))}

        {showNew ? (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3 mt-3">
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Report name (e.g. Investors)"
              value={newName} onChange={(e) => setNewName(e.target.value)}
            />
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              rows={4}
              placeholder="Describe the audience and what to focus on — e.g. 'Investor update focused on growth metrics and revenue trends. Concise, 6 slides max.'"
              value={newInstructions} onChange={(e) => setNewInstructions(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground shrink-0">Target slides:</label>
              <input type="number" min={3} max={30}
                className="w-20 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={newSlideHint} onChange={(e) => setNewSlideHint(Number(e.target.value))}
              />
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setShowNew(false)} className="p-1.5 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
                <button onClick={addTemplate} disabled={newSaving || !newName.trim() || !newInstructions.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
                  <Check className="h-3.5 w-3.5" />{newSaving ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Plus className="h-4 w-4" /> Add report template
          </button>
        )}
      </Section>
      )}

        </div>
      </div>
    </div>
  );
}
