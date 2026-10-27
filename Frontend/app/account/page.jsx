"use client";

import { useState } from "react";
import AppShell from "../../components/AppShell";
import { Alert, Field, Loading, PageHeader, Sheet } from "../../components/ui";
import { api, API } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useGate, useResource } from "../../lib/hooks";
import { saveTokens, updateUser } from "../../lib/session";
import { NewPasswordFields, checkNewPassword } from "../../components/PasswordFields";

const FIELDS = ["first_name", "middle_name", "last_name", "email", "phone1", "phone2"];
const ROLE = { secretary: "Secretary", resident: "Resident", guard: "Guard" };

// Everyone's own profile
export default function AccountPage() {
  const user = useGate("member");
  const { data, error, setData } = useResource(user ? API.me : null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [passwordNote, setPasswordNote] = useState(null);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <div className="page page-narrow">
        <PageHeader
          title="Account"
          description="Your name and contact details. Your secretary sees these."
          actions={data && !editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(true); setSaved(false); }}>Edit</button>}
        />
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}
        {saved && !editing && <div style={{ marginBottom: 16 }}><Alert kind="ok">Your details were saved.</Alert></div>}

        {data && (
          <div className="panel panel-pad">
            {editing ? (
              <ProfileForm
                profile={data}
                onCancel={() => setEditing(false)}
                onSaved={(p) => {
                  setData(p);
                  updateUser({ full_name: p.full_name, email: p.email });
                  setEditing(false);
                  setSaved(true);
                }}
              />
            ) : (
              <dl className="kv">
                <dt>Name</dt><dd>{data.full_name || <span className="faint">Not set</span>}</dd>
                <dt>Username</dt><dd>{data.username}</dd>
                <dt>Role</dt><dd>{ROLE[data.role]}{data.building ? ` · ${data.building.name}` : ""}</dd>
                <dt>Email</dt><dd>{data.email || <span className="faint">Not added</span>}</dd>
                <dt>Phone</dt><dd className="num">{data.phone1 || <span className="faint">Not added</span>}</dd>
                {data.phone2 && <><dt>Other phone</dt><dd className="num">{data.phone2}</dd></>}
                <dt>Member since</dt><dd>{formatDate(data.date_joined)}</dd>
              </dl>
            )}
          </div>
        )}

        {data && (
          <section className="section" style={{ marginTop: 36 }}>
            <div className="section-head"><h2>Password</h2></div>
            {passwordNote && <div style={{ marginBottom: 12 }}><Alert kind="ok">{passwordNote}</Alert></div>}
            <div className="panel panel-pad" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="mono" style={{ letterSpacing: "0.2em" }} aria-hidden="true">••••••••</div>
                <p className="small muted" style={{ marginTop: 4, maxWidth: 420 }}>
                  {user.role === "secretary"
                    ? "Your password is managed by the administrator. Contact them to change it."
                    : "Forgot it? Your secretary can reset it for you."}
                </p>
              </div>
              {user.role !== "secretary" && (
                <button type="button" className="btn btn-secondary" onClick={() => { setResetting(true); setPasswordNote(null); }}>
                  Reset password
                </button>
              )}
            </div>
          </section>
        )}

        {resetting && (
          <ResetPasswordSheet
            onClose={() => setResetting(false)}
            onDone={() => {
              setResetting(false);
              setPasswordNote("Password changed. You've been signed out on your other devices.");
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

const EMPTY_PASSWORDS = { current_password: "", new_password: "", confirm_password: "" };

// A resident or guard sets a new password; they confirm it's them with the current one
function ResetPasswordSheet({ onClose, onDone }) {
  const [form, setForm] = useState(EMPTY_PASSWORDS);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    const errs = checkNewPassword(form);
    if (!form.current_password) errs.current_password = "Enter your current password.";
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const data = await api(API.changePassword, { method: "POST", json: form });
      saveTokens(data); // this device stays signed in with the new tokens
      onDone();
    } catch (err) {
      const fieldErrs = Object.fromEntries(Object.keys(EMPTY_PASSWORDS).map((k) => [k, err.field(k)]).filter(([, v]) => v));
      setErrors(fieldErrs);
      if (!Object.keys(fieldErrs).length) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Reset password"
      description="You'll stay signed in here; your other devices are signed out."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <Field id="pw-current" label="Current password" error={errors.current_password}>
          <input id="pw-current" type="password" className={`input ${errors.current_password ? "invalid" : ""}`}
            value={form.current_password} onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
            autoComplete="current-password" autoFocus />
        </Field>
        <NewPasswordFields idPrefix="pw" value={form} onChange={setForm} errors={errors} />
        <button type="submit" hidden />
      </form>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

function ProfileForm({ profile, onCancel, onSaved }) {
  const [form, setForm] = useState(Object.fromEntries(FIELDS.map((f) => [f, profile[f] ?? ""])));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(FIELDS.map((f) => [f, form[f].trim()]));
    const errs = {};
    if (!body.first_name) errs.first_name = "Enter your first name.";
    if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) errs.email = "Enter a valid email address.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      onSaved(await api(API.me, { method: "PATCH", json: body }));
    } catch (err) {
      const fieldErrs = Object.fromEntries(FIELDS.map((f) => [f, err.field(f)]).filter(([, v]) => v));
      setErrors(fieldErrs);
      if (!Object.keys(fieldErrs).length) setError(err.message);
      setBusy(false);
    }
  }

  const input = (name, label, props = {}) => (
    <Field id={`me-${name}`} label={label} error={errors[name]} optional={props.optional}>
      <input id={`me-${name}`} className={`input ${errors[name] ? "invalid" : ""}`} value={form[name]} onChange={set(name)}
        type={props.type} autoComplete={props.autoComplete} autoFocus={props.autoFocus} />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="field-row">
        {input("first_name", "First name", { autoComplete: "given-name", autoFocus: true })}
        {input("middle_name", "Middle name", { autoComplete: "additional-name", optional: true })}
        {input("last_name", "Last name", { autoComplete: "family-name" })}
      </div>
      {input("email", "Email", { type: "email", autoComplete: "email", optional: true })}
      <div className="field-row" style={{ marginTop: 16 }}>
        {input("phone1", "Phone", { type: "tel", autoComplete: "tel", optional: true })}
        {input("phone2", "Other phone", { type: "tel", optional: true })}
      </div>
      <p className="field-hint" style={{ marginTop: 16 }}>Your username ({profile.username}) can&apos;t be changed.</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {error && <div style={{ marginTop: 12 }}><Alert>{error}</Alert></div>}
    </form>
  );
}
