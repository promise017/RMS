"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Field, Sheet, Status } from "./ui";
import { api, API } from "../lib/api";
import { formatDate, localDay, money } from "../lib/format";
import { photoSrc } from "../lib/photos";

export const KINDS = [
  { value: "fonepay", label: "Fonepay QR" },
  { value: "bank", label: "Bank transfer" },
  { value: "esewa", label: "eSewa" },
  { value: "khalti", label: "Khalti" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

const STATUS = {
  pending: { value: "unpaid", label: "Waiting for confirmation" },
  confirmed: { value: "paid", label: "Confirmed" },
  rejected: { value: "overdue", label: "Rejected" },
};

const plainAmount = (n) => String(Math.max(0, Number(n)).toFixed(2)).replace(/\.00$/, "");

// The payments made towards a bill. The secretary can confirm, reject or reverse them.
export function PaymentList({ payments, canDecide = false, onChanged }) {
  if (!payments.length) return null;
  return (
    <ul className="pay-list">
      {payments.map((p) => <PaymentItem key={p.id} payment={p} canDecide={canDecide} onChanged={onChanged} />)}
    </ul>
  );
}

function PaymentItem({ payment: p, canDecide, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const s = STATUS[p.status];
  const reversed = p.status === "rejected" && p.receipt_no;

  async function decide(kind) {
    if (kind === "reject" && !reason.trim()) {
      setError("Say why, so the resident knows what to do.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(kind === "confirm" ? API.confirmPayment(p.id) : API.rejectPayment(p.id), {
        method: "POST",
        json: kind === "confirm" ? {} : { reason: reason.trim() },
      });
      setRejecting(false);
      onChanged?.();
    } catch (err) {
      setError(err.field("reason") || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="pay-item">
      <div className="pay-main">
        <div>
          <span className="pay-amount num">{money(p.amount)}</span>
          <span className="muted"> · {p.method_label || p.kind_label}</span>
        </div>
        <Status value={s.value}>{reversed ? "Reversed" : s.label}</Status>
      </div>
      <div className="pay-meta">
        <span>Paid {formatDate(p.paid_on)}</span>
        {p.reference && <span className="mono">Ref {p.reference}</span>}
        {p.submitted_by && <span>Reported by {p.submitted_by}</span>}
        {p.proof && <a href={photoSrc(p.proof)} target="_blank" rel="noreferrer" className="link">Screenshot</a>}
        {p.receipt_no && <Link href={`/receipt?id=${p.id}`} className="link">Receipt {p.receipt_no}</Link>}
      </div>
      {p.note && <p className="small muted" style={{ marginTop: 4 }}>{p.note}</p>}
      {p.status === "rejected" && p.reject_reason && (
        <p className="small" style={{ marginTop: 4, color: "var(--red)" }}>{reversed ? "Reversed" : "Rejected"}: {p.reject_reason}</p>
      )}

      {canDecide && p.status !== "rejected" && !rejecting && (
        <div className="pay-actions">
          {p.status === "pending" && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => decide("confirm")} disabled={busy}>Confirm</button>
          )}
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setRejecting(true)} disabled={busy}>
            {p.status === "pending" ? "Reject" : "Reverse"}
          </button>
        </div>
      )}
      {rejecting && (
        <div className="pay-reject">
          <input className="input input-sm" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder={p.status === "pending" ? "e.g. No payment with this ID reached the account" : "e.g. Cheque bounced"}
            aria-label="Reason" />
          <button type="button" className="btn btn-danger btn-sm" onClick={() => decide("reject")} disabled={busy}>
            {p.status === "pending" ? "Reject" : "Reverse"}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setRejecting(false); setError(null); }}>Cancel</button>
        </div>
      )}
      {error && <div style={{ marginTop: 6 }}><Alert>{error}</Alert></div>}
    </li>
  );
}

// "Paid Rs. 5,000 of Rs. 12,000 · Rs. 7,000 left"
export function PaidSummary({ bill }) {
  const paid = Number(bill.amount_paid);
  const pending = Number(bill.amount_pending);
  if (!paid && !pending) return null;
  return (
    <p className="small muted" style={{ marginTop: 10 }}>
      {paid > 0 && <>Paid <b className="num" style={{ color: "var(--ink)" }}>{money(bill.amount_paid)}</b> of {money(bill.total)}</>}
      {Number(bill.balance) > 0 && <> · <b className="num" style={{ color: "var(--ink)" }}>{money(bill.balance)}</b> left</>}
      {pending > 0 && <> · {money(bill.amount_pending)} waiting for confirmation</>}
    </p>
  );
}

// Shared form fields for a new payment
function PaymentFields({ form, setForm, errors, methods, byResident }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const proofInput = useRef(null);
  const choice = form.method ? `m${form.method}` : form.kind;

  function choose(value) {
    if (value.startsWith("m")) {
      const m = methods.find((x) => `m${x.id}` === value);
      setForm((f) => ({ ...f, method: m.id, kind: m.kind }));
    } else {
      setForm((f) => ({ ...f, method: null, kind: value }));
    }
  }

  return (
    <>
      <div className="field-row">
        <Field id="p-amount" label="Amount (Rs.)" error={errors.amount}>
          <input id="p-amount" type="number" min="0.01" step="0.01" inputMode="decimal" className={`input num ${errors.amount ? "invalid" : ""}`}
            value={form.amount} onChange={set("amount")} />
        </Field>
        <Field id="p-date" label="Paid on" error={errors.paid_on}>
          <input id="p-date" type="date" className={`input ${errors.paid_on ? "invalid" : ""}`} value={form.paid_on} max={localDay()}
            onChange={set("paid_on")} />
        </Field>
      </div>
      <Field id="p-kind" label="How was it paid?" error={errors.kind}>
        <select id="p-kind" className="select" value={choice} onChange={(e) => choose(e.target.value)}>
          {methods.length > 0 && (
            <optgroup label={byResident ? "Building's payment options" : "Your payment options"}>
              {methods.map((m) => <option key={m.id} value={`m${m.id}`}>{m.label} ({m.kind_label})</option>)}
            </optgroup>
          )}
          <optgroup label="Other ways">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </optgroup>
        </select>
      </Field>
      <Field id="p-ref" label="Transaction ID" optional={!byResident || ["cash", "cheque"].includes(form.kind)} error={errors.reference}
        hint={byResident ? "From the bank or wallet app's confirmation screen." : undefined}>
        <input id="p-ref" className={`input mono ${errors.reference ? "invalid" : ""}`} value={form.reference} onChange={set("reference")}
          autoComplete="off" spellCheck={false} />
      </Field>
      {byResident && (
        <Field id="p-proof" label="Screenshot" optional error={errors.proof} hint="A screenshot of the payment helps your secretary confirm it.">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => proofInput.current?.click()}>
              {form.proof ? "Change screenshot" : "Attach screenshot"}
            </button>
            {form.proof && <span className="small muted">{form.proof.name}</span>}
            <input ref={proofInput} id="p-proof" type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setForm((x) => ({ ...x, proof: f })); }} />
          </div>
        </Field>
      )}
      <Field id="p-note" label="Note" optional>
        <input id="p-note" className="input" value={form.note} onChange={set("note")} maxLength={200} />
      </Field>
    </>
  );
}

function toForm(form) {
  const body = new FormData();
  body.append("amount", form.amount);
  body.append("kind", form.kind);
  if (form.method) body.append("payment_method", form.method);
  body.append("reference", form.reference.trim());
  body.append("paid_on", form.paid_on);
  body.append("note", form.note.trim());
  if (form.proof) body.append("proof", form.proof);
  return body;
}

const fieldErrors = (err) =>
  Object.fromEntries(["amount", "kind", "payment_method", "reference", "paid_on", "proof", "note"]
    .map((k) => [k === "payment_method" ? "kind" : k, err.field(k)]).filter(([, v]) => v));

// Secretary: record money received (e.g. cash). Confirmed straight away.
export function RecordPaymentSheet({ bill, onClose, onSaved }) {
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState({ amount: plainAmount(bill.balance), kind: "cash", method: null, reference: "", paid_on: localDay(), note: "", proof: null });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(API.paymentMethods).then((d) => setMethods(d.methods)).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api(API.recordPayment(bill.id), { method: "POST", form: toForm(form) });
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Record a payment"
      description={`Unit ${bill.unit_info.name} · ${money(bill.balance)} left to pay. It's confirmed straight away and gets a receipt.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record payment"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <PaymentFields form={form} setForm={setForm} errors={errors} methods={methods} byResident={false} />
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

function Copy({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-quiet btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
    }}>
      {done ? "Copied" : label}
    </button>
  );
}

// Resident: how to pay the building, then "I've paid"
export function PayBillSheet({ bill, onClose, onReported }) {
  const [data, setData] = useState(null);
  const [step, setStep] = useState("pay"); // "pay" | "report"
  const left = Math.max(0, Number(bill.balance) - Number(bill.amount_pending));
  const [form, setForm] = useState({ amount: plainAmount(left), kind: "fonepay", method: null, reference: "", paid_on: localDay(), note: "", proof: null });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(API.myPaymentMethods).then((d) => {
      setData(d);
      if (d.methods[0]) setForm((f) => ({ ...f, method: d.methods[0].id, kind: d.methods[0].kind }));
    }).catch((err) => setError(err.message));
  }, []);

  async function report() {
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api(API.reportPayment(bill.id), { method: "POST", form: toForm(form) });
      onReported();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) setError(err.message);
      setBusy(false);
    }
  }

  const recentChange = data?.changed_at && (Date.now() - new Date(data.changed_at)) < 14 * 86_400_000;

  return (
    <Sheet
      title={step === "pay" ? `Pay ${money(left)}` : "I've paid"}
      description={step === "pay"
        ? "Pay with your bank or wallet app, then tell your secretary here."
        : "Your secretary checks the payment and confirms it."}
      onClose={onClose}
      footer={step === "pay" ? (
        <>
          <button type="button" className="btn btn-primary" onClick={() => setStep("report")}>I&apos;ve paid</button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary" onClick={report} disabled={busy}>{busy ? "Sending…" : "Send to secretary"}</button>
          <button type="button" className="btn btn-quiet" onClick={() => setStep("pay")} disabled={busy}>Back</button>
        </>
      )}
    >
      {step === "pay" ? (
        <>
          <div className="pay-remark">
            <div>
              <div className="small faint">Write this in the payment remarks</div>
              <div className="mono pay-remark-code">{bill.remark_code}</div>
            </div>
            <Copy text={bill.remark_code} />
          </div>

          {recentChange && (
            <div style={{ marginTop: 12 }}>
              <Alert kind="info">The building&apos;s payment details were updated on {formatDate(data.changed_at)}. Use the details below.</Alert>
            </div>
          )}

          {!data ? <p className="small muted" style={{ marginTop: 16 }}>Loading payment options…</p> : data.methods.length === 0 ? (
            <p className="muted" style={{ marginTop: 16 }}>
              Your secretary hasn&apos;t added payment details yet. Pay them the usual way, then tap <b>I&apos;ve paid</b>.
            </p>
          ) : (
            <div className="pay-methods">
              {data.methods.map((m) => (
                <div key={m.id} className="pay-method">
                  <div className="pay-method-head">
                    <strong>{m.label}</strong>
                    <span className="small faint">{m.kind_label}</span>
                  </div>
                  {m.qr && (
                    <div className="pay-qr">
                      <img src={photoSrc(m.qr)} alt={`QR code to pay ${m.account_name}`} />
                      <a href={photoSrc(m.qr)} download className="link small">Save QR image</a>
                    </div>
                  )}
                  <dl className="kv pay-kv">
                    <dt>Pays to</dt><dd><b>{m.account_name}</b></dd>
                    {m.account_number && <><dt>Account no.</dt><dd className="mono">{m.account_number} <Copy text={m.account_number} /></dd></>}
                    {m.bank_name && <><dt>Bank</dt><dd>{m.bank_name}{m.branch ? `, ${m.branch}` : ""}</dd></>}
                  </dl>
                </div>
              ))}
            </div>
          )}
          {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
        </>
      ) : (
        <>
          <PaymentFields form={form} setForm={setForm} errors={errors} methods={data?.methods ?? []} byResident />
          {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
        </>
      )}
    </Sheet>
  );
}
