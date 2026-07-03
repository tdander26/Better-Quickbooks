"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wallet, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push(params.get("next") || "/");
      router.refresh();
    } else {
      setError("Incorrect password. Try again.");
      setPassword("");
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
            <Wallet size={26} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Better Books</h1>
            <p className="muted text-sm">Enter your PIN or password to continue</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="password"
            inputMode="text"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input text-center"
          />
          {error && <p className="text-center text-sm text-rose-500">{error}</p>}
          <button className="btn-primary" disabled={loading || !password}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
