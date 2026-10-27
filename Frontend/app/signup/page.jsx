"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthLayout from "../../components/AuthLayout";
import { Alert, Field, Segmented } from "../../components/ui";
import { API, errorText } from "../../lib/api";
import { homePathFor, readJson, saveSession } from "../../lib/session";

const EMPTY = {
  role: "resident", first_name: "", last_name: "", username: "", email: "",
  phone1: "", password: "", confirm_password: "",
};

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  function validate() {
    const errs = {};
    if (!form.first_name.trim()) errs.first_name = "Enter your first name.";
    if (!form.last_name.trim()) errs.last_name = "Enter your last name.";
    if (!form.username.trim()) errs.username = "Choose a username.";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = "Enter a valid email address.";
    if (form.password.length < 8) errs.password = "Use at least 8 characters.";
    if (form.confirm_password !== form.password) errs.confirm_password = "The passwords don't match.";
    return errs;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k.includes("password") ? v : v.trim()]));
      const res = await fetch(API.signup, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (res.ok) {
        saveSession(data);
        router.replace(homePathFor(data.user));
        return;
      }
      // Show Django's messages beside the matching fields
      const fieldErrs = {};
      for (const [k, v] of Object.entries(data ?? {})) if (k in EMPTY) fieldErrs[k] = [].concat(v).join(" ");
      setErrors(fieldErrs);
      if (!Object.keys(fieldErrs).length) setError(errorText(data, res.status));
    } catch {
      setError("Couldn't reach the server. Check that Django is running.");
    } finally {
      setBusy(false);
    }
  }

  const input = (name, label, props = {}) => (
    <Field id={name} label={label} error={errors[name]} optional={props.optional}>
      <input id={name} className={`input ${errors[name] ? "invalid" : ""}`} value={form[name]} onChange={set(name)}
        {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== "optional"))} />
    </Field>
  );

  return (
    <AuthLayout>
      <h1>Create an account</h1>
      <p className="lead">After signing up you&apos;ll enter your building&apos;s join code.</p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <span className="field-label">I am a</span>
          <Segmented
            label="Account type"
            value={form.role}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
            options={[{ value: "resident", label: "Resident" }, { value: "guard", label: "Guard" }]}
          />
        </div>
        <div className="field-row" style={{ marginTop: 16 }}>
          {input("first_name", "First name", { autoComplete: "given-name", autoFocus: true })}
          {input("last_name", "Last name", { autoComplete: "family-name" })}
        </div>
        {input("username", "Username", { autoComplete: "username", autoCapitalize: "none" })}
        <div className="field-row" style={{ marginTop: 16 }}>
          {input("phone1", "Phone", { type: "tel", autoComplete: "tel", optional: true })}
          {input("email", "Email", { type: "email", autoComplete: "email", optional: true })}
        </div>
        <div className="field-row" style={{ marginTop: 16 }}>
          {input("password", "Password", { type: "password", autoComplete: "new-password" })}
          {input("confirm_password", "Confirm password", { type: "password", autoComplete: "new-password" })}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        {error && <div style={{ marginTop: 12 }}><Alert>{error}</Alert></div>}
      </form>
      <p className="auth-switch">
        Already have an account? <Link href="/login" className="link">Sign in</Link>
        <br />
        <span className="faint">Secretary accounts are set up by the administrator.</span>
      </p>
    </AuthLayout>
  );
}
