"use client";

import { useRef, useState } from "react";
import AppShell from "../../../components/AppShell";
import { KINDS, PaymentList } from "../../../components/Payments";
import { Alert, Empty, Field, Loading, PageHeader, Sheet } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { formatDateTime, money, monthLabel } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";
import { photoSrc } from "../../../lib/photos";

export default function PaymentsPage() {
  const user = useGate("secretary");
  const pending = useResource(user ? `${API.payments}?status=pending` : null);
  const recent = useResource(user ? API.payments : null);
  const methods = useResource(user ? API.paymentMethods : null);
  const [sheet, setSheet] = useState(null); // { kind: "method", method? } | { kind: "remove", method }

  if (!user) return null;

  const refresh = () => { pending.reload(); recent.reload(); };
  const decided = (recent.data ?? []).filter((p) => p.status !== "pending").slice(0, 15);

  return (
    <AppShell user={user}>
      <div className="page page-narrow">
        <PageHeader title="Payments" description="Confirm payments residents report, and set how they can pay the building." />

        {/* ---------------- payments waiting for a check */}
        <section className="section">
          <div className="section-head">
            <div>
              <h2>To confirm</h2>
              <p>Check each one against your bank or wallet statement.</p>
            </div>
          </div>
          {pending.error && <Alert>{pending.error}</Alert>}
          <div className="panel">
            {!pending.data ? <Loading /> : pending.data.length === 0 ? (
              <Empty>Nothing to confirm right now.</Empty>
            ) : (
              <ul className="rows">
                {groupByBill(pending.data).map(({ bill, payments }) => (
                  <li key={bill.id} className="confirm-group">
                    <div className="confirm-head">
                      <strong>Unit {bill.unit} · {monthLabel(bill.period)}</strong>
                      <span className="small muted">Bill total {money(bill.total)}</span>
                    </div>
                    <PaymentList payments={payments} canDecide onChanged={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---------------- recent decisions */}
        {decided.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>Recent payments</h2></div>
            <div className="panel">
              <ul className="rows">
                {decided.map((p) => (
                  <li key={p.id} className="row" style={{ cursor: "default" }}>
                    <span className="row-main">
                      <span className="row-title">Unit {p.bill_info.unit} · {monthLabel(p.bill_info.period)}</span>
                      <span className="row-sub">
                        {[p.method_label || p.kind_label, p.reference && `Ref ${p.reference}`, p.submitted_by].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="row-end">
                      <span className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>{money(p.amount)}</span>
                      {p.status === "confirmed"
                        ? <a href={`/receipt?id=${p.id}`} className="link small">Receipt</a>
                        : <span className="small" style={{ color: "var(--red)" }}>{p.receipt_no ? "Reversed" : "Rejected"}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ---------------- how residents pay */}
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Payment details</h2>
              <p>Shown to residents when they pay a bill. Changes need your password, and residents are told about them.</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet({ kind: "method" })}>Add</button>
          </div>
          {methods.error && <Alert>{methods.error}</Alert>}
          {!methods.data ? <Loading /> : methods.data.methods.length === 0 ? (
            <div className="panel">
              <Empty title="No payment details yet"
                action={<div><button type="button" className="btn btn-primary" onClick={() => setSheet({ kind: "method" })}>Add a QR code or bank account</button></div>}>
                Add the building&apos;s QR code (Fonepay, eSewa, Khalti or your bank&apos;s) and/or bank account, so residents can pay you directly.
              </Empty>
            </div>
          ) : (
            <div className="method-cards">
              {methods.data.methods.map((m) => (
                <div key={m.id} className="panel method-card">
                  {m.qr ? <img src={photoSrc(m.qr)} alt="" className="method-qr" /> : <div className="method-qr empty">No QR</div>}
                  <div className="method-info">
                    <strong>{m.label}</strong>
                    <span className="small faint">{m.kind_label}</span>
                    <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: "92px 1fr", fontSize: 13 }}>
                      <dt>Pays to</dt><dd>{m.account_name}</dd>
                      {m.account_number && <><dt>Account</dt><dd className="mono">{m.account_number}</dd></>}
                      {m.bank_name && <><dt>Bank</dt><dd>{m.bank_name}{m.branch ? `, ${m.branch}` : ""}</dd></>}
                    </dl>
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet({ kind: "method", method: m })}>Edit</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setSheet({ kind: "remove", method: m })}>Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {methods.data?.log.length > 0 && (
            <details className="change-log">
              <summary className="small muted">Change history</summary>
              <ul>
                {methods.data.log.map((c) => (
                  <li key={c.id} className="small">
                    <span className="faint">{formatDateTime(c.created_at)}</span> · {c.summary}{c.changed_by ? ` · ${c.changed_by}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {sheet?.kind === "method" && (
          <MethodSheet method={sheet.method} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); methods.reload(); }} />
        )}
        {sheet?.kind === "remove" && (
          <RemoveMethodSheet method={sheet.method} onClose={() => setSheet(null)} onRemoved={() => { setSheet(null); methods.reload(); }} />
        )}
      </div>
    </AppShell>
  );
}

// Pending payments grouped under their bill
function groupByBill(payments) {
  const groups = new Map();
  payments.forEach((p) => {
    if (!groups.has(p.bill)) groups.set(p.bill, { bill: p.bill_info, payments: [] });
    groups.get(p.bill).payments.push(p);
  });
  return [...groups.values()];
}

const KIND_CHOICES = KINDS.filter((k) => ["fonepay", "bank", "esewa", "khalti"].includes(k.value));

function MethodSheet({ method, onClose, onSaved }) {
  const [form, setForm] = useState({
    kind: method?.kind ?? "fonepay",
    label: method?.label ?? "",
    account_name: method?.account_name ?? "",
    account_number: method?.account_number ?? "",
    bank_name: method?.bank_name ?? "",
    branch: method?.branch ?? "",
  });
  const [qr, setQr] = useState(null); // { file, url }
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const errs = {};
    if (!form.label.trim()) errs.label = "Give it a short name residents will recognise.";
    if (!form.account_name.trim()) errs.account_name = "Whose account is it? Residents see this before paying.";
    if (!qr && !method?.qr && !form.account_number.trim()) errs.account_number = "Add a QR code image, an account number, or both.";
    if (!password) errs.password = "Enter your password to confirm this change.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = new FormData();
    Object.entries(form).forEach(([k, v]) => body.append(k, v.trim()));
    if (qr) body.append("qr", qr.file);
    body.append("password", password);

    setBusy(true);
    setError(null);
    try {
      await api(method ? API.paymentMethod(method.id) : API.paymentMethods, { method: method ? "PATCH" : "POST", form: body });
      onSaved();
    } catch (err) {
      const fe = Object.fromEntries(["kind", "label", "account_name", "account_number", "bank_name", "branch", "qr", "password"]
        .map((k) => [k, err.field(k)]).filter(([, v]) => v));
      setErrors(fe);
      if (!Object.keys(fe).length) setError(err.message);
      setBusy(false);
    }
  }

  const field = (k, label, props = {}) => (
    <Field id={`m-${k}`} label={label} optional={props.optional} error={errors[k]} hint={props.hint}>
      <input id={`m-${k}`} className={`input ${props.mono ? "mono" : ""} ${errors[k] ? "invalid" : ""}`} value={form[k]} onChange={set(k)}
        placeholder={props.placeholder} autoComplete="off" />
    </Field>
  );

  return (
    <Sheet
      title={method ? "Edit payment option" : "Add a payment option"}
      description="A QR code residents scan with their bank or wallet app, and/or bank account details."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <div className="field-row">
        <Field id="m-kind" label="Type">
          <select id="m-kind" className="select" value={form.kind} onChange={set("kind")}>
            {KIND_CHOICES.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        {field("label", "Name", { placeholder: "Scan with any bank app" })}
      </div>
      {field("account_name", "Account holder", { placeholder: "Himalaya Heights Society", hint: "Residents see whose account they're paying." })}

      <Field id="m-qr" label="QR code" optional error={errors.qr}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {(qr || method?.qr) && <img src={qr ? qr.url : photoSrc(method.qr)} alt="" className="method-qr small" />}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
            {qr || method?.qr ? "Replace QR image" : "Upload QR image"}
          </button>
          <input ref={input} id="m-qr" type="file" accept="image/*" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setQr({ file: f, url: URL.createObjectURL(f) });
          }} />
        </div>
      </Field>

      <div className="field-row" style={{ marginTop: 16 }}>
        {field("account_number", "Account number", { optional: true, mono: true })}
        {field("bank_name", "Bank", { optional: true, placeholder: "NIC Asia Bank" })}
      </div>
      {field("branch", "Branch", { optional: true })}

      <div className="detail-divider" />
      <Field id="m-password" label="Your password" error={errors.password} hint="Needed for any change to payment details.">
        <input id="m-password" type="password" className={`input ${errors.password ? "invalid" : ""}`} value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

function RemoveMethodSheet({ method, onClose, onRemoved }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(API.paymentMethod(method.id), { method: "DELETE", json: { password } });
      onRemoved();
    } catch (err) {
      setError(err.field("password") || err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Remove "${method.label}"?`}
      description="Residents won't see it any more. Past payments made with it stay on record."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-danger" style={{ border: "1px solid currentColor" }} onClick={remove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <Field id="r-password" label="Your password" error={error}>
        <input id="r-password" type="password" className={`input ${error ? "invalid" : ""}`} value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
      </Field>
    </Sheet>
  );
}

