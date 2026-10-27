"use client";

import { useState } from "react";
import AppShell from "../../../components/AppShell";
import { Alert, BillStatus, Empty, Loading, PageHeader } from "../../../components/ui";
import { PaidSummary, PayBillSheet, PaymentList } from "../../../components/Payments";
import { API } from "../../../lib/api";
import { formatDate, money, monthLabel, plural } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";

export default function ResidentBills() {
  const user = useGate("resident");
  const { data, error, reload } = useResource(user ? API.myBills : null);
  const methods = useResource(user ? API.myPaymentMethods : null);
  const [paying, setPaying] = useState(null);   // the bill being paid
  const [note, setNote] = useState(null);
  const [openId, setOpenId] = useState(null);

  if (!user) return null;

  const unpaid = data?.filter((b) => b.status === "unpaid") ?? [];
  const owed = unpaid.reduce((n, b) => n + Number(b.balance), 0);
  const overdue = unpaid.filter((b) => b.is_overdue);
  const dueSoon = unpaid.filter((b) => b.due_soon);
  const dueIn = (b) => (b.days_until_due === 0 ? "today" : b.days_until_due === 1 ? "tomorrow" : `in ${b.days_until_due} days`);
  // Only mention the unit if they've been billed for more than one (e.g. after moving)
  const manyUnits = new Set(data?.map((b) => b.unit.id)).size > 1;

  return (
    <AppShell user={user}>
      <div className="page page-narrow">
        <PageHeader
          title="Bills"
          description={data && (unpaid.length
            ? `${money(owed)} outstanding across ${plural(unpaid.length, "bill")}${overdue.length ? `, ${overdue.length} overdue` : ""}.`
            : "You're all paid up.")}
        />
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}

        {note && <div style={{ marginBottom: 12 }}><Alert kind="ok">{note}</Alert></div>}
        {methods.data?.changed_at && (Date.now() - new Date(methods.data.changed_at)) < 14 * 86_400_000 && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="info">
              Your building&apos;s payment details were updated on {formatDate(methods.data.changed_at)}. Use the new details when you pay.
            </Alert>
          </div>
        )}

        {/* Reminders: overdue first, then anything due within a few days */}
        {overdue.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Alert>
              {overdue.length === 1
                ? `Your ${monthLabel(overdue[0].period)} bill of ${money(overdue[0].total)} is overdue by ${plural(overdue[0].days_overdue, "day")}.`
                : `${plural(overdue.length, "bill")} are overdue, ${money(overdue.reduce((n, b) => n + Number(b.total), 0))} in total.`}
              {" "}Please pay your secretary as soon as you can.
            </Alert>
          </div>
        )}
        {dueSoon.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="info">
              {dueSoon.map((b) => `Your ${monthLabel(b.period)} bill of ${money(b.total)} is due ${dueIn(b)} (${formatDate(b.due_date)}).`).join(" ")}
            </Alert>
          </div>
        )}

        {data && (
          <div className="panel">
            {data.length === 0 ? (
              <Empty title="No bills yet">Your monthly bills will appear here when your secretary sends them.</Empty>
            ) : (
              <ul className="rows">
                {data.map((b) => {
                  const open = openId === b.id;
                  const paid = b.status === "paid";
                  return (
                    <li key={b.id}>
                      <button type="button" className="row" aria-expanded={open} onClick={() => setOpenId(open ? null : b.id)}>
                        <span className="row-main">
                          <span className="row-title">{monthLabel(b.period)}</span>
                          <span className="row-sub">
                            {[
                              manyUnits && `Unit ${b.unit.name}`,
                              paid ? `Paid ${formatDate(b.paid_at)}` : b.due_soon ? `Due ${dueIn(b)}` : `Due ${formatDate(b.due_date)}`,
                              b.changed_at && `Updated ${formatDate(b.changed_at)}`,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="row-end">
                          <span className="num" style={{ color: "var(--ink)", fontWeight: 600 }}>{money(b.total)}</span>
                          <BillStatus bill={b} />
                        </span>
                      </button>
                      {open && (
                        <div style={{ padding: "4px 16px 18px" }}>
                          <table className="lines">
                            <tbody>
                              {b.items.map((item, i) => <tr key={i}><td>{item.title}</td><td>{money(item.amount)}</td></tr>)}
                            </tbody>
                            <tfoot>
                              <tr><td>Total</td><td>{money(b.total)}</td></tr>
                            </tfoot>
                          </table>
                          {b.note && <p className="prose small muted" style={{ marginTop: 12 }}>{b.note}</p>}
                          <PaidSummary bill={b} />
                          {b.payments.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <PaymentList payments={b.payments} />
                            </div>
                          )}
                          {!paid && Number(b.balance) - Number(b.amount_pending) > 0 && (
                            <div className="form-actions" style={{ marginTop: 14 }}>
                              <button type="button" className="btn btn-primary" onClick={() => { setPaying(b); setNote(null); }}>
                                Pay {money(Number(b.balance) - Number(b.amount_pending))}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {paying && (
          <PayBillSheet
            bill={paying}
            onClose={() => setPaying(null)}
            onReported={() => {
              setPaying(null);
              setNote("Thanks. Your secretary will check the payment and confirm it. You'll get a receipt here.");
              reload();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
