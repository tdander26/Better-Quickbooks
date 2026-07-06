"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

// Enabled by setting NEXT_PUBLIC_DEMO_LOGIN="1" in the environment. Inlined at
// build time, so it's a compile-time constant here.
const DEMO_ENABLED = process.env.NEXT_PUBLIC_DEMO_LOGIN === "1";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  function go() {
    router.push(params.get("next") || "/");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.ok) {
      go();
    } else {
      setError("Incorrect email or password.");
      setPassword("");
    }
  }

  async function onDemo() {
    setDemoLoading(true);
    setError("");
    const res = await signIn("demo", { redirect: false });
    setDemoLoading(false);
    if (res?.ok) go();
    else setError("Demo sign-in is turned off right now.");
  }

  const next = params.get("next");
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="flex items-baseline gap-2">
            <span className="serif" style={{ fontSize: 30 }}>
              Ledger
            </span>
            <span
              className="uppercase"
              style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.08em" }}
            >
              Better Books
            </span>
          </div>
          <p className="muted text-sm">Sign in to continue</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          {error && (
            <p className="text-center text-sm" style={{ color: "var(--red)" }}>
              {error}
            </p>
          )}
          <button className="btn-primary" disabled={loading || !email || !password}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : "Sign in"}
          </button>
        </form>

        <p className="muted mt-5 text-center text-sm">
          New to Better Books?{" "}
          <Link href={signupHref} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Create an account
          </Link>
        </p>

        {DEMO_ENABLED && (
          <>
            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1" style={{ background: "var(--border)" }} />
              <span className="text-xs" style={{ color: "var(--faint)" }}>
                or
              </span>
              <span className="h-px flex-1" style={{ background: "var(--border)" }} />
            </div>
            <button onClick={onDemo} disabled={demoLoading} className="btn-ghost w-full">
              {demoLoading ? <Loader2 className="animate-spin" size={16} /> : "Continue to demo — no password"}
            </button>
            <p className="muted mt-2 text-center text-xs">Preview mode · anyone with the link can view</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
