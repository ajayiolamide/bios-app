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
import { Loader2 } from "lucide-react";

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

    // Navigate to onboarding wizard so the user sets up their first goal.
    // Full navigation — bypasses Next.js client cache so the org is visible.
    window.location.href = "/onboarding";
  }

  return (
    <Card className="border-gray-100 bg-white shadow-sm">
      <CardHeader className="space-y-3 text-center">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-metrik.svg" alt="Metrik" className="h-7 w-auto" />
        </div>
        <CardTitle className="text-2xl font-bold text-gray-900 tracking-tight">
          Create your workspace
        </CardTitle>
        <CardDescription className="text-gray-500">
          Where your team&apos;s analytics will live.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-gray-700">
              Organization name
            </Label>
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
              className="w-full border-0 border-b border-gray-200 bg-transparent px-0 py-1.5 text-xl font-semibold text-gray-900 placeholder:text-gray-400 placeholder:font-normal focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
            />
            <p className="text-xs text-gray-400">
              This will be your company or team name inside Metrik.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
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

          <p className="text-xs text-gray-400 text-center">
            Next, we&apos;ll help you set your first goal.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
