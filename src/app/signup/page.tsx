"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Wallet, Loader2 } from "lucide-react";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, businessName, email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't create your account.");
      setLoading(false);
      return;
    }

    // Account created — sign in and land in the app.
    const login = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (login?.ok) {
      router.push(params.get("next") || "/");
      router.refresh();
    } else {
      // Created but auto-login failed — send them to the login screen.
      router.push("/login");
    }
  }

  const next = params.get("next");
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
            <Wallet size={26} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Create your account</h1>
            <p className="muted text-sm">Start keeping better books</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="text"
            autoComplete="name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
          <input
            type="text"
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="input"
          />
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          {error && <p className="text-center text-sm text-rose-500">{error}</p>}
          <button className="btn-primary" disabled={loading || !email || password.length < 8}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : "Create account"}
          </button>
        </form>
        <p className="muted mt-5 text-center text-sm">
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
