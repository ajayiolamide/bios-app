"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrganization } from "@/app/actions/organizations";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BarChart3, Loader2 } from "lucide-react";

export default function CreateWorkspacePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(e.currentTarget);
    const result = await createOrganization(null, formData);

    if (result && "error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    // Full navigation — bypasses Next.js client cache entirely
    // so the dashboard layout always sees the freshly created org.
    window.location.href = "/dashboard";
  }

  return (
    <Card className="border-slate-700 bg-slate-800/50 backdrop-blur-sm">
      <CardHeader className="space-y-3 text-center">
        <div className="flex justify-center">
          <div className="flex items-center justify-center rounded-xl bg-blue-600 p-3">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
        </div>
        {/* Bigger, more confident headline — same correction as the Goals
            page first-run state: say the one thing plainly, in a size that
            reads as a real first moment rather than a generic form title. */}
        <CardTitle className="text-3xl font-bold text-white tracking-tight">
          Create your workspace
        </CardTitle>
        <CardDescription className="text-slate-400">
          Where your team&apos;s analytics will live. Invite people after this.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-slate-300">
              Organization name
            </Label>
            {/* Heading-style underlined field instead of a boxed input with
                an icon inset — same sparse, "this is the one thing that
                matters right now" treatment as the name fields in the Goals
                wizards, applied to the very first field anyone fills in. */}
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Acme Corp"
              required
              minLength={2}
              maxLength={60}
              disabled={pending}
              autoFocus
              className="w-full border-0 border-b border-slate-600 bg-transparent px-0 py-1.5 text-xl font-semibold text-white placeholder:text-slate-500 placeholder:font-normal focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
            />
            <p className="text-xs text-slate-500">
              This will be your company or team name inside Metrik.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating workspace…
              </>
            ) : (
              "Create workspace"
            )}
          </Button>

          {/* "What happens next" — this used to be a dead-end form with no
              sense of where it leads. One line, so it doesn't compete with
              the button above it. */}
          <p className="text-xs text-slate-500 text-center">
            Next, we&apos;ll help you set your first goal.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
