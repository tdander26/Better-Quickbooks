"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Wallet, Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.ok) {
      router.push(params.get("next") || "/");
      router.refresh();
    } else {
      setError("Incorrect email or password.");
      setPassword("");
    }
  }

  const next = params.get("next");
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
            <Wallet size={26} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Welcome back</h1>
            <p className="muted text-sm">Sign in to Better Books</p>
          </div>
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
          {error && <p className="text-center text-sm text-rose-500">{error}</p>}
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
