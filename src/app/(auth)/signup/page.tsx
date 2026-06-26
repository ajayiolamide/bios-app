"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { checkEmailAllowed, markEmailUsed } from "@/app/actions/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    // Check guest list before creating the account
    const access = await checkEmailAllowed(email);
    if (!access.allowed) {
      setError(access.reason ?? "Access denied.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          org_name: orgName,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    await markEmailUsed(email);
    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <Card className="border-gray-100 bg-white shadow-sm">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="flex justify-center">
            <CheckCircle2 className="h-12 w-12 text-indigo-500" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Check your email</h2>
          <p className="text-gray-500">
            We sent a confirmation link to{" "}
            <span className="text-gray-900 font-medium">{email}</span>. Click it to
            activate your account.
          </p>
          <Link href="/login">
            <Button variant="outline" className="border-gray-200 text-gray-600 hover:bg-gray-50">
              Back to login
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gray-100 bg-white shadow-sm">
      <CardHeader className="space-y-3 text-center">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-metrik.svg" alt="Metrik" className="h-7 w-auto" />
        </div>
        <CardTitle className="text-2xl text-gray-900 tracking-tight">Create your account</CardTitle>
        <CardDescription className="text-gray-500">
          Get started with Metrik
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName" className="text-gray-700">
              Full name
            </Label>
            <Input
              id="fullName"
              type="text"
              placeholder="Jane Smith"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgName" className="text-gray-700">
              Organization name
            </Label>
            <Input
              id="orgName"
              type="text"
              placeholder="Acme Corp"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              className="border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-gray-700">
              Work email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-gray-700">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-500"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-gray-500">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
