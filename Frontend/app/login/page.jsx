"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthLayout from "../../components/AuthLayout";
import { Alert, Field } from "../../components/ui";
import { API, errorText } from "../../lib/api";
import { getSession, homePathFor, readJson, saveSession } from "../../lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Already signed in: go straight in
  useEffect(() => {
    const s = getSession();
    if (s) router.replace(homePathFor(s.user));
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(API.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(res.status === 401 ? "That username and password don't match." : errorText(data, res.status));
        return;
      }
      saveSession(data);
      router.replace(homePathFor(data.user));
    } catch {
      setError("Couldn't reach the server. Check that Django is running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <p className="lead">Secretaries, residents and guards all sign in here.</p>
      <form onSubmit={submit} noValidate>
        <Field id="username" label="Username">
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)}
            autoComplete="username" autoCapitalize="none" autoFocus />
        </Field>
        <Field id="password" label="Password">
          <input id="password" type="password" className="input" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error && <div style={{ marginTop: 12 }}><Alert>{error}</Alert></div>}
      </form>
      <p className="auth-switch">
        New resident or guard? <Link href="/signup" className="link">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
