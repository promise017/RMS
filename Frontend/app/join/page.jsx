"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthLayout from "../../components/AuthLayout";
import { Alert, Field } from "../../components/ui";
import { api, API } from "../../lib/api";
import { clearSession, getSession, homePathFor, updateUser } from "../../lib/session";

// Residents and guards connect their account to a building with its join code
export default function JoinPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) router.replace("/login");
    else if (homePathFor(s.user) !== "/join") router.replace(homePathFor(s.user));
    else setUser(s.user);
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    if (!code.trim()) {
      setError("Enter the join code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api(API.join, { method: "POST", json: { code } });
      updateUser({ building: data.building });
      router.replace(homePathFor({ ...user, building: data.building }));
    } catch (err) {
      setError(err.field("code") || err.message);
      setBusy(false);
    }
  }

  function signOut() {
    clearSession();
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <AuthLayout>
      <h1>Join your building</h1>
      <p className="lead">Enter the 8-character code from your building&apos;s secretary.</p>
      <form onSubmit={submit} noValidate>
        <Field id="code" label="Join code" error={error}>
          <input
            id="code"
            className={`input code-input ${error ? "invalid" : ""}`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Joining…" : "Join building"}
        </button>
      </form>
      <p className="auth-switch">
        Signed in as {user.username}. <button type="button" className="link" onClick={signOut}>Sign out</button>
      </p>
    </AuthLayout>
  );
}
