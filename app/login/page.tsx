"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const from = searchParams.get("from");
        router.replace(from && from.startsWith("/analyst") ? from : "/analyst");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Sign-in failed");
        setSubmitting(false);
      }
    } catch {
      setError("Network error — try again");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        width: 340,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--paper)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-4)",
        padding: "28px 28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="brand-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gito-bird.png" alt="Gito" width={28} height={28} style={{ objectFit: "contain" }} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Gito · Analyst Portal</div>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em" }}>Sign in</div>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="password">Password</label>
        <input
          id="password"
          className="ipt"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
        />
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: "var(--err)" }}>{error}</div>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={!password || submitting}
        style={{ justifyContent: "center", opacity: !password || submitting ? 0.6 : 1 }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--paper-2)",
        padding: 16,
      }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
