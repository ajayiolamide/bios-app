"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getInvitationPreview, acceptInvitation } from "@/app/actions/team";
import { Loader2, CheckCircle2, AlertCircle, Users } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Can invite members and manage the workspace",
  member: "Full access to view and edit data",
  viewer: "Read-only access to the workspace",
};

function AcceptInviteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [preview, setPreview] = useState<{
    org_name?: string;
    role?: string;
    email?: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPreviewError("No invitation token found in the URL.");
      return;
    }

    getInvitationPreview(token).then((res) => {
      if (res.error) setPreviewError(res.error);
      else setPreview(res);
    });

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    const res = await acceptInvitation(token);
    if (res.error) {
      setError(res.error);
      setAccepting(false);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/"), 1500);
  }

  function handleSignIn() {
    router.push(`/login?next=/accept-invite?token=${token}`);
  }

  if (!token || (preview === null && previewError === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">M</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border shadow-sm p-8 space-y-6">

          {previewError && (
            <div className="text-center space-y-3">
              <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
              <h1 className="text-lg font-semibold">Invitation unavailable</h1>
              <p className="text-sm text-muted-foreground">{previewError}</p>
              <button
                onClick={() => router.push("/")}
                className="mt-2 text-sm text-indigo-600 hover:underline"
              >
                Go to Metrik
              </button>
            </div>
          )}

          {done && (
            <div className="text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
              <h1 className="text-lg font-semibold">You&apos;re in!</h1>
              <p className="text-sm text-muted-foreground">
                Welcome to <strong>{preview?.org_name}</strong>. Redirecting…
              </p>
            </div>
          )}

          {preview && !done && (
            <>
              <div className="text-center space-y-1">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 mb-2">
                  <Users className="h-6 w-6 text-indigo-600" />
                </div>
                <h1 className="text-xl font-semibold">You&apos;re invited</h1>
                <p className="text-sm text-muted-foreground">
                  Join <strong>{preview.org_name}</strong> on Metrik
                </p>
              </div>

              <div className="rounded-xl border bg-slate-50 px-5 py-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                    {ROLE_LABELS[preview.role ?? "member"] ?? preview.role}
                  </span>
                  <span className="text-sm text-muted-foreground">role</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ROLE_DESCRIPTIONS[preview.role ?? "member"]}
                </p>
              </div>

              {preview.email && (
                <p className="text-xs text-center text-muted-foreground">
                  This invitation was sent to <strong>{preview.email}</strong>.
                  {isLoggedIn === false && " Sign in with that address to accept."}
                </p>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {isLoggedIn === null ? (
                <div className="flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : isLoggedIn ? (
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {accepting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {accepting ? "Joining…" : "Accept invitation"}
                </button>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={handleSignIn}
                    className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                  >
                    Sign in to accept
                  </button>
                  <p className="text-xs text-center text-muted-foreground">
                    New to Metrik?{" "}
                    <button
                      onClick={() => router.push(`/signup?next=/accept-invite?token=${token}`)}
                      className="text-indigo-600 hover:underline"
                    >
                      Create an account
                    </button>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
