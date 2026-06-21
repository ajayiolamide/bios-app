"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrganization } from "@/app/actions/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BarChart3, Building2, Loader2 } from "lucide-react";

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
        <CardTitle className="text-2xl text-white">
          Create your workspace
        </CardTitle>
        <CardDescription className="text-slate-400">
          Your workspace is where your team&apos;s analytics live. You can
          invite members after setup.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-slate-300">
              Organization name
            </Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Acme Corp"
                required
                minLength={2}
                maxLength={60}
                disabled={pending}
                className="pl-9 border-slate-600 bg-slate-700/50 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
              />
            </div>
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
        </form>
      </CardContent>
    </Card>
  );
}
