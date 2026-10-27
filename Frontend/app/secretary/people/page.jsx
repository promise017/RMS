"use client";

import { useState } from "react";
import AppShell from "../../../components/AppShell";
import { Alert, Empty, Field, Loading, PageHeader, Segmented, Sheet } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { formatDate, money, plural } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";
import { NewPasswordFields, checkNewPassword, suggestPassword } from "../../../components/PasswordFields";
import JoinCode from "../../../components/JoinCode";

export default function PeoplePage() {
  const user = useGate("secretary");
  const { data, error, setData } = useResource(user ? API.members : null);
  const building = useResource(user ? API.building : null);
  const [tab, setTab] = useState("residents");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null); // the resident or guard
  const [note, setNote] = useState(null);

  if (!user) return null;

  const replaceResident = (saved) =>
    setData((d) => ({ ...d, residents: d.residents.map((r) => (r.id === saved.id ? saved : r)) }));

  return (
    <AppShell user={user}>
      <div className="page">
        <PageHeader
          title="People"
          description="Residents join with the building code and choose their own unit. You can correct it here."
          actions={tab === "guards" && data && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add guard</button>
          )}
        />

        {building.data?.building && (
          <div style={{ marginBottom: 28 }}>
            <JoinCode building={building.data.building} onBuilding={(b) => building.setData({ building: b })} />
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}

        {data && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Segmented
                label="Show"
                value={tab}
                onChange={(t) => { setTab(t); setNote(null); }}
                options={[
                  { value: "residents", label: "Residents", count: data.residents.length },
                  { value: "guards", label: "Guards", count: data.guards.length },
                ]}
              />
            </div>
            {note && <div style={{ marginBottom: 12 }}><Alert kind={note.kind}>{note.text}</Alert></div>}

            {tab === "residents" ? (
              <Residents residents={data.residents} units={data.units} onSaved={replaceResident} onNote={setNote} onReset={setResetting} />
            ) : (
              <Guards
                guards={data.guards}
                onRemoved={(g) => {
                  setData((d) => ({ ...d, guards: d.guards.filter((x) => x.id !== g.id) }));
                  setNote({ kind: "ok", text: `${g.full_name || g.username} was removed. If they know the join code, make a new one on the Overview page.` });
                }}
                onNote={setNote}
                onAdd={() => setAdding(true)}
                onReset={setResetting}
              />
            )}
          </>
        )}

        {resetting && (
          <ResetPasswordSheet
            member={resetting}
            onClose={() => setResetting(null)}
            onDone={(text) => { setResetting(null); setNote({ kind: "ok", text }); }}
          />
        )}

        {adding && (
          <AddGuardSheet
            onClose={() => setAdding(false)}
            onAdded={(g) => {
              setData((d) => ({ ...d, guards: [...d.guards, g] }));
              setAdding(false);
              setTab("guards");
              setNote({ kind: "ok", text: `${g.full_name || g.username} can now sign in as ${g.username} with the password you set.` });
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function Residents({ residents, units, onSaved, onNote, onReset }) {
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);

  async function assign(r, unitId) {
    const owes = r.unpaid?.count > 0;
    if (owes && String(r.unit?.id ?? "") !== String(unitId)) {
      const name = r.full_name || r.username;
      const ok = window.confirm(
        `${name} still owes ${money(r.unpaid.total)} on ${plural(r.unpaid.count, "bill")}. ` +
        "Those bills stay on their name after the move. Continue?",
      );
      if (!ok) return;
    }
    setSavingId(r.id);
    onNote(null);
    try {
      const saved = await api(API.residentUnit(r.id), { method: "PATCH", json: { unit: unitId ? Number(unitId) : null } });
      onSaved(saved);
    } catch (err) {
      onNote({ kind: "error", text: err.message });
    } finally {
      setSavingId(null);
    }
  }

  if (!residents.length) {
    return (
      <div className="panel">
        <Empty title="No residents yet">Share the join code from the Overview page. Residents choose their unit after joining.</Empty>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? residents.filter((r) => [r.full_name, r.username, r.phone1, r.email, r.unit?.name].some((v) => v && String(v).toLowerCase().includes(q)))
    : residents;

  return (
    <>
      {residents.length > 8 && (
        <input type="search" className="input" style={{ maxWidth: 320, marginBottom: 12 }} placeholder="Search name, phone or unit"
          value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search residents" />
      )}
      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Unit</th><th className="right">Owes</th><th className="hide-sm">Phone</th><th className="hide-sm">Joined</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="cell-strong">{r.full_name || r.username}</div>
                  <div className="tiny faint">{r.username}{r.email ? ` · ${r.email}` : ""}</div>
                </td>
                <td>
                  <select
                    className="select input-sm"
                    style={{ width: "auto", minWidth: 150 }}
                    value={r.unit?.id ?? ""}
                    onChange={(e) => assign(r, e.target.value)}
                    disabled={savingId === r.id || !units.length}
                    aria-label={`Unit for ${r.full_name || r.username}`}
                  >
                    <option value="">No unit</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name} · Floor {u.floor}</option>)}
                  </select>
                </td>
                <td className="right num">
                  {r.unpaid?.count
                    ? <span title={plural(r.unpaid.count, "unpaid bill")} style={{ fontWeight: 500 }}>{money(r.unpaid.total)}</span>
                    : <span className="faint">—</span>}
                </td>
                <td className="num hide-sm">{r.phone1 ? <a href={`tel:${r.phone1}`} className="link">{r.phone1}</a> : <span className="faint">—</span>}</td>
                <td className="hide-sm muted">{formatDate(r.date_joined)}</td>
                <td className="right">
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => onReset(r)}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>No residents match “{query}”.</Empty>}
      </div>
    </>
  );
}

function Guards({ guards, onRemoved, onNote, onAdd, onReset }) {
  const [busyId, setBusyId] = useState(null);

  async function remove(g) {
    const name = g.full_name || g.username;
    if (!window.confirm(`Remove ${name} from the building? Their account stays, but they lose access.`)) return;
    setBusyId(g.id);
    onNote(null);
    try {
      await api(API.guard(g.id), { method: "DELETE" });
      onRemoved(g);
    } catch (err) {
      onNote({ kind: "error", text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  if (!guards.length) {
    return (
      <div className="panel">
        <Empty
          title="No guards yet"
          action={<div><button type="button" className="btn btn-secondary" onClick={onAdd}>Add guard</button></div>}
        >
          Create a login for them here, or they can sign up as a guard and enter the join code.
        </Empty>
      </div>
    );
  }

  return (
    <div className="panel table-wrap">
      <table className="table">
        <thead>
          <tr><th>Name</th><th>Phone</th><th className="hide-sm">Joined</th><th /></tr>
        </thead>
        <tbody>
          {guards.map((g) => (
            <tr key={g.id}>
              <td>
                <div className="cell-strong">{g.full_name || g.username}</div>
                <div className="tiny faint">{g.username}</div>
              </td>
              <td className="num">{g.phone1 ? <a href={`tel:${g.phone1}`} className="link">{g.phone1}</a> : <span className="faint">—</span>}</td>
              <td className="hide-sm muted">{formatDate(g.date_joined)}</td>
              <td className="right" style={{ whiteSpace: "nowrap" }}>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => onReset(g)}>Reset password</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(g)} disabled={busyId === g.id}>
                  {busyId === g.id ? "Removing…" : "Remove"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GUARD = { first_name: "", last_name: "", username: "", phone1: "", password: "" };

function AddGuardSheet({ onClose, onAdded }) {
  const [form, setForm] = useState(GUARD);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  async function submit(e) {
    e?.preventDefault();
    const errs = {};
    if (!form.first_name.trim()) errs.first_name = "Enter their first name.";
    if (!form.username.trim()) errs.username = "Choose the username they'll sign in with.";
    if (form.password.length < 8) errs.password = "Use at least 8 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k === "password" ? v : v.trim()]));
      onAdded(await api(API.guards, { method: "POST", json: body }));
    } catch (err) {
      const fieldErrs = Object.fromEntries(Object.keys(GUARD).map((k) => [k, err.field(k)]).filter(([, v]) => v));
      setErrors(fieldErrs);
      if (!Object.keys(fieldErrs).length) setError(err.message);
      setBusy(false);
    }
  }

  const input = (name, label, props = {}) => (
    <Field id={`g-${name}`} label={label} error={errors[name]} optional={props.optional} hint={props.hint}>
      <input id={`g-${name}`} className={`input ${errors[name] ? "invalid" : ""}`} value={form[name]} onChange={set(name)}
        type={props.type} autoComplete={props.autoComplete ?? "off"} autoFocus={props.autoFocus} />
    </Field>
  );

  return (
    <Sheet
      title="Add guard"
      description="Creates their login and adds them to this building. Give them the username and password."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add guard"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <div className="field-row">
          {input("first_name", "First name", { autoFocus: true })}
          {input("last_name", "Last name", { optional: true })}
        </div>
        {input("username", "Username")}
        {input("phone1", "Phone", { type: "tel", optional: true })}
        {input("password", "Password", { type: "password", autoComplete: "new-password", hint: "At least 8 characters, not too common." })}
        <button type="submit" hidden />
      </form>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

// The secretary sets a new password for a resident or guard who can't get in
function ResetPasswordSheet({ member, onClose, onDone }) {
  const [form, setForm] = useState({ new_password: "", confirm_password: "" });
  const [suggested, setSuggested] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const name = member.full_name || member.username;

  function suggest() {
    const pw = suggestPassword();
    setForm({ new_password: pw, confirm_password: pw });
    setSuggested(true); // show it so it can be read out
    setErrors({});
  }

  async function submit(e) {
    e?.preventDefault();
    const errs = checkNewPassword(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      await api(API.resetPassword(member.id), { method: "POST", json: form });
      onDone(`${name}'s password was reset and they were signed out. Give them the new password: they sign in as ${member.username}.`);
    } catch (err) {
      const fieldErrs = { new_password: err.field("new_password"), confirm_password: err.field("confirm_password") };
      setErrors(fieldErrs);
      if (!fieldErrs.new_password && !fieldErrs.confirm_password) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Reset ${name}'s password`}
      description={`They sign in as ${member.username}. Their old password stops working and they're signed out everywhere.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <NewPasswordFields idPrefix="reset" value={form} onChange={setForm} errors={errors} autoFocus reveal={suggested} />
        <button type="button" className="link small" style={{ marginTop: 12 }} onClick={suggest}>Suggest a password</button>
        <p className="field-hint" style={{ marginTop: 16 }}>
          Tell them the new password in person or by phone. They can change it themselves from their Account page.
        </p>
        <button type="submit" hidden />
      </form>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}
