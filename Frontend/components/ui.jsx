"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloseIcon } from "./Icons";

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function BackLink({ href, children }) {
  return <Link href={href}>← {children}</Link>;
}

// Label + control + hint/error, wired up for screen readers
export function Field({ id, label, optional, hint, error, children }) {
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={id}>
          {label} {optional && <span className="optional">(optional)</span>}
        </label>
      )}
      {children}
      {error ? <span className="field-error" id={`${id}-error`}>{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Alert({ kind = "error", children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Loading({ children = "Loading…" }) {
  return <div className="loading">{children}</div>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      {title && <strong>{title}</strong>}
      {children}
      {action}
    </div>
  );
}

// Filter control: options = [{ value, label, count? }]
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

const STATUS_TONE = {
  open: "is-red", in_progress: "is-amber", resolved: "is-green",
  draft: "", unpaid: "is-amber", overdue: "is-red", paid: "is-green",
};
const STATUS_LABEL = {
  open: "Open", in_progress: "In progress", resolved: "Resolved",
  draft: "Draft", unpaid: "Unpaid", overdue: "Overdue", paid: "Paid",
};

// A bill's state for display: draft, paid, overdue (with days) or unpaid
export function billState(bill) {
  if (bill.is_draft) return { value: "draft", label: "Draft" };
  if (bill.status === "paid") return { value: "paid", label: "Paid" };
  if (Number(bill.amount_pending) > 0) return { value: "unpaid", label: "Payment to confirm" };
  if (bill.is_overdue) return { value: "overdue", label: `Overdue · ${bill.days_overdue} ${bill.days_overdue === 1 ? "day" : "days"}` };
  if (Number(bill.amount_paid) > 0) return { value: "unpaid", label: "Partly paid" };
  return { value: "unpaid", label: "Unpaid" };
}

export function BillStatus({ bill }) {
  const state = billState(bill);
  return <Status value={state.value}>{state.label}</Status>;
}

// A coloured dot and a word. dotOnly keeps the word for screen readers only (dense lists).
export function Status({ value, children, dotOnly }) {
  const text = children ?? STATUS_LABEL[value] ?? value;
  return (
    <span className={`status ${STATUS_TONE[value] ?? ""}`} title={dotOnly ? text : undefined}>
      {dotOnly ? <span className="visually-hidden">{text}</span> : text}
    </span>
  );
}

// A panel that slides in from the right, for forms that need room
export function Sheet({ title, description, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}
