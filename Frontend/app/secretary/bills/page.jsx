"use client";

import { useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import { ChevronLeft, ChevronRight, CloseIcon } from "../../../components/Icons";
import { GrowBar } from "../../../components/CountUp";
import { PaidSummary, PaymentList, RecordPaymentSheet } from "../../../components/Payments";
import { Alert, BillStatus, Empty, Field, Loading, Segmented, Sheet, Status, billState } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { currentMonth, formatDate, money, monthLabel, plural, shiftMonth } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";

const dueDefault = (ym) => `${ym}-15`;
// Same limits as the server: not before the month starts, at most 6 months after
const dueMin = (ym) => `${ym}-01`;
const dueMax = (ym) => `${shiftMonth(ym, 6)}-01`;

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// One unit's state this month, for the floor dots and the unit rows
function unitState(unit, bill) {
  if (!bill) return unit.residents > 0 ? "unbilled" : "vacant";
  if (bill.is_draft) return "draft";
  if (bill.status === "paid") return "paid";
  return bill.is_overdue ? "overdue" : "unpaid";
}

// "3 overdue · 1 draft not sent", "All paid ✓", ...
function floorSummary(rows) {
  const n = (s) => rows.filter((r) => r.state === s).length;
  const parts = [];
  if (n("overdue")) parts.push(`${n("overdue")} overdue`);
  if (n("unpaid")) parts.push(`${n("unpaid")} unpaid`);
  if (n("draft")) parts.push(`${plural(n("draft"), "draft")} not sent`);
  if (n("unbilled")) parts.push(`${n("unbilled")} not billed`);
  if (parts.length) return { text: parts.join(" · "), attention: true };
  if (n("paid")) return { text: "All paid ✓", attention: false, done: true };
  return { text: rows.length ? "Vacant" : "No units", attention: false };
}

export default function BillsPage() {
  const user = useGate("secretary");
  const [month, setMonth] = useState(currentMonth);
  const monthBills = useResource(user ? `${API.bills}?period=${month}` : null);
  const unpaidBills = useResource(user ? `${API.bills}?status=unpaid` : null);
  const floors = useResource(user ? API.floors : null);
  const [filter, setFilter] = useState("all"); // "all" | "attention" | "paid"
  const [open, setOpen] = useState([]);        // floor numbers that are expanded
  const [sheet, setSheet] = useState(null);    // { kind: "bill", id } | { kind: "bill-units" } | { kind: "earlier" }
  const [note, setNote] = useState(null);
  const [sending, setSending] = useState(false);

  // Every floor (top first) with its units and this month's bill for each
  const rows = useMemo(() => {
    if (!floors.data || !monthBills.data) return null;
    const byUnit = Object.fromEntries(monthBills.data.map((b) => [b.unit, b]));
    return [...floors.data.floors]
      .sort((a, b) => b.number - a.number)
      .map((f) => {
        const units = f.units.map((u) => {
          const bill = byUnit[u.id];
          return { unit: { ...u, floor: f.number }, bill, state: unitState(u, bill) };
        });
        const due = units
          .filter((r) => r.state === "overdue" || r.state === "unpaid")
          .reduce((sum, r) => sum + Number(r.bill.balance), 0);
        return { number: f.number, units, due, summary: floorSummary(units) };
      });
  }, [floors.data, monthBills.data]);

  if (!user) return null;

  const bills = monthBills.data ?? [];
  const units = rows?.flatMap((f) => f.units) ?? [];
  const drafts = bills.filter((b) => b.is_draft);
  const sent = bills.filter((b) => !b.is_draft);
  const billedTotal = sent.reduce((n, b) => n + Number(b.total), 0);
  const collected = sent.reduce((n, b) => n + Number(b.amount_paid), 0);
  const unbilled = units.filter((r) => !r.bill).map((r) => r.unit);
  const earlier = (unpaidBills.data ?? []).filter((b) => b.period !== month);
  const earlierOverdue = earlier.filter((b) => b.is_overdue);

  // The month's usual due date, said once instead of on every row
  const dueCounts = {};
  sent.forEach((b) => { dueCounts[b.due_date] = (dueCounts[b.due_date] ?? 0) + 1; });
  const usualDue = Object.keys(dueCounts).sort((a, b) => dueCounts[b] - dueCounts[a] || a.localeCompare(b))[0];

  const shown = (rows ?? []).filter((f) =>
    filter === "all" ? true : filter === "attention" ? f.summary.attention : f.summary.done);
  const toggle = (n) => setOpen((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]));
  const allOpen = shown.length > 0 && shown.every((f) => open.includes(f.number));

  function refresh() {
    monthBills.reload();
    unpaidBills.reload();
  }
  const replaceBill = (saved) => {
    monthBills.setData((l) => l?.map((b) => (b.id === saved.id ? saved : b)));
    unpaidBills.reload();
  };
  const openBill = [...bills, ...(unpaidBills.data ?? [])].find((b) => sheet?.kind === "bill" && b.id === sheet.id);

  async function sendDrafts() {
    if (!window.confirm(`Send ${plural(drafts.length, "draft bill")} for ${monthLabel(month)}? Residents will see them straight away.`)) return;
    setSending(true);
    setNote(null);
    try {
      const { sent: n } = await api(API.sendBills, { method: "POST", json: { period: month } });
      setNote({ kind: "ok", text: `Sent ${plural(n, "bill")} to residents.` });
      refresh();
    } catch (err) {
      setNote({ kind: "error", text: err.message });
    } finally {
      setSending(false);
    }
  }

  const changeMonth = (by) => { setMonth((m) => shiftMonth(m, by)); setNote(null); setOpen([]); };
  const ready = rows !== null;

  // One main action: whatever is needed next
  const primary = drafts.length
    ? { label: sending ? "Sending…" : `Send ${plural(drafts.length, "draft")}`, onClick: sendDrafts }
    : unbilled.length ? { label: "Bill units", onClick: () => setSheet({ kind: "bill-units" }) } : null;

  return (
    <AppShell user={user}>
      <div className="page">
        <header className="bills-head">
          <div className="bills-title">
            <h1>Bills</h1>
            <div className="month-nav">
              <button type="button" className="icon-btn" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft /></button>
              <strong>{monthLabel(month)}</strong>
              <button type="button" className="icon-btn" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight /></button>
            </div>
            {usualDue && <span className="small faint">Due {formatDate(usualDue)}</span>}
            {month !== currentMonth() && (
              <button type="button" className="link small" onClick={() => { setMonth(currentMonth()); setOpen([]); }}>This month</button>
            )}
          </div>
          <div className="page-actions">
            {drafts.length > 0 && unbilled.length > 0 && (
              <button type="button" className="btn btn-quiet" onClick={() => setSheet({ kind: "bill-units" })}>Bill units</button>
            )}
            {ready && primary && (
              <button type="button" className="btn btn-primary" onClick={primary.onClick} disabled={sending}>{primary.label}</button>
            )}
          </div>
        </header>

        {ready && billedTotal > 0 && (
          <div className="bills-progress">
            <div className="meter" role="img" aria-label={`${pct(collected, billedTotal)}% collected`}>
              <GrowBar percent={pct(collected, billedTotal)} />
            </div>
            <p className="small muted">
              <b className="num" style={{ color: "var(--ink)" }}>{pct(collected, billedTotal)}%</b> collected
              {" · "}<span className="num">{money(billedTotal - collected)}</span> still to come
            </p>
          </div>
        )}

        {earlierOverdue.length > 0 && (
          <p className="bills-earlier">
            Plus {plural(earlierOverdue.length, "overdue bill")} from other months
            ({money(earlierOverdue.reduce((n, b) => n + Number(b.balance), 0))}).{" "}
            <button type="button" className="link" onClick={() => setSheet({ kind: "earlier" })}>View</button>
          </p>
        )}

        {note && <div style={{ marginBottom: 12 }}><Alert kind={note.kind}>{note.text}</Alert></div>}
        {(monthBills.error || floors.error) && <Alert>{monthBills.error || floors.error}</Alert>}

        {!ready ? <Loading /> : units.length === 0 ? (
          <div className="panel"><Empty title="No units yet">Add your building&apos;s units on the Building page before billing.</Empty></div>
        ) : (
          <>
            <div className="section-head" style={{ marginBottom: 10 }}>
              <Segmented
                label="Show floors"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "attention", label: "Needs attention", count: rows.filter((f) => f.summary.attention).length },
                  { value: "paid", label: "Paid", count: rows.filter((f) => f.summary.done).length },
                ]}
              />
              {shown.length > 0 && (
                <button type="button" className="link small" onClick={() => setOpen(allOpen ? [] : shown.map((f) => f.number))}>
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>

            <div className="panel">
              {shown.length === 0 ? (
                <Empty>{filter === "paid" ? "No floor is fully paid yet." : "Nothing needs attention on any floor."}</Empty>
              ) : (
                <ul className="rows">
                  {shown.map((f) => (
                    <FloorRow
                      key={f.number}
                      floor={f}
                      open={open.includes(f.number)}
                      onToggle={() => toggle(f.number)}
                      onOpenBill={(id) => setSheet({ kind: "bill", id })}
                    />
                  ))}
                </ul>
              )}
            </div>
            {bills.length === 0 && (
              <p className="small muted" style={{ marginTop: 12 }}>
                Nothing billed for {monthLabel(month)} yet. Use <b>Bill units</b> to create this month&apos;s bills.
              </p>
            )}
          </>
        )}

        {openBill && (
          <BillSheet
            bill={openBill}
            onClose={() => setSheet(null)}
            onSaved={replaceBill}
            onDeleted={() => { setSheet(null); refresh(); }}
          />
        )}
        {sheet?.kind === "earlier" && (
          <Sheet title="Unpaid from other months" description="Most overdue first. Select one to open it." onClose={() => setSheet(null)}>
            <ul className="rows">
              {earlier.map((b) => (
                <li key={b.id}>
                  <button type="button" className="row" style={{ padding: "10px 0" }} onClick={() => setSheet({ kind: "bill", id: b.id })}>
                    <span className="row-main">
                      <span className="row-title">{b.unit_info.name} · {monthLabel(b.period)}</span>
                      <span className="row-sub">{(b.billed_to.length ? b.billed_to.map((p) => p.name) : b.residents).join(", ") || "Nobody recorded"}</span>
                    </span>
                    <span className="row-end">
                      <span className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>{money(b.total)}</span>
                      <BillStatus bill={b} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        )}
        {sheet?.kind === "bill-units" && (
          <BillUnitsSheet
            month={month}
            units={unbilled}
            onClose={() => setSheet(null)}
            onDone={(result) => {
              setSheet(null);
              const skipped = result.skipped_no_charges.length;
              setNote({
                kind: "ok",
                text: (result.sent ? `Created and sent ${plural(result.created, "bill")}.` : `Created ${plural(result.created, "draft bill")}. Add per-unit charges, then send them.`) +
                  (skipped ? ` Skipped ${plural(skipped, "unit")} with no rent and no charges.` : ""),
              });
              refresh();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

const DOT_LABEL = { paid: "Paid", unpaid: "Unpaid", overdue: "Overdue", draft: "Draft", unbilled: "Not billed", vacant: "Vacant" };

// A floor: one row with a dot per unit and a summary; opens to show its units
function FloorRow({ floor, open, onToggle, onOpenBill }) {
  return (
    <li>
      <button type="button" className="floor-row" aria-expanded={open} onClick={onToggle}>
        <span className="floor-name">Floor {floor.number}</span>
        <span className="floor-dots" aria-hidden="true">
          {floor.units.map((r) => <span key={r.unit.id} className={`fdot fdot-${r.state}`} title={`${r.unit.name}: ${DOT_LABEL[r.state]}`} />)}
        </span>
        <span className={`floor-summary ${floor.summary.done ? "is-done" : ""}`}>{floor.summary.text}</span>
        <span className="floor-due num">{floor.due > 0 ? `${money(floor.due)} due` : ""}</span>
        <span className={`floor-chevron ${open ? "is-open" : ""}`} aria-hidden="true"><ChevronRight /></span>
      </button>

      {open && (
        <ul className="floor-units">
          {floor.units.map(({ unit, bill, state }) => {
            const who = bill
              ? (bill.billed_to.length ? bill.billed_to.map((p) => p.name) : bill.residents).join(", ")
              : "";
            const content = (
              <>
                <span className="fu-name">{unit.name}</span>
                <span className="fu-who">{who || (state === "vacant" ? "Vacant" : unit.residents ? plural(unit.residents, "resident") : "")}</span>
                <span className="fu-amount num">{bill ? money(bill.status === "paid" || bill.is_draft ? bill.total : bill.balance) : ""}</span>
                <span className="fu-status">
                  {bill ? <BillStatus bill={bill} /> : <Status value="draft">{DOT_LABEL[state]}</Status>}
                </span>
              </>
            );
            return (
              <li key={unit.id}>
                {bill
                  ? <button type="button" className="fu-row" onClick={() => onOpenBill(bill.id)}>{content}</button>
                  : <div className="fu-row is-static">{content}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- One bill */

function BillSheet({ bill, onClose, onSaved, onDeleted }) {
  const [mode, setMode] = useState("view"); // "view" | "edit" | "record"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const reload = async () => onSaved(await api(API.bill(bill.id)));
  const send = () => run(async () => {
    await api(API.sendBills, { method: "POST", json: { ids: [bill.id] } });
    await reload();
  });
  const remove = () => {
    if (!window.confirm(`Delete the ${monthLabel(bill.period)} bill for unit ${bill.unit_info.name}?`)) return;
    run(async () => { await api(API.bill(bill.id), { method: "DELETE" }); onDeleted(); });
  };

  const paid = bill.status === "paid";
  const state = billState(bill);
  const title = `Unit ${bill.unit_info.name}`;
  const description = `Floor ${bill.unit_info.floor} · ${monthLabel(bill.period)}`;
  const hasPayments = bill.payments.some((p) => p.status !== "rejected");

  if (mode === "edit") {
    return (
      <EditBillSheet bill={bill} title={title} description={description} onClose={() => setMode("view")}
        onSaved={(saved) => { onSaved(saved); setMode("view"); }} />
    );
  }
  if (mode === "record") {
    return <RecordPaymentSheet bill={bill} onClose={() => setMode("view")} onSaved={async () => { await reload(); setMode("view"); }} />;
  }

  let footer;
  if (bill.is_draft) {
    footer = (
      <>
        <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>Send to residents</button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("edit")} disabled={busy}>Edit</button>
        <button type="button" className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={remove} disabled={busy}>Delete</button>
      </>
    );
  } else if (!paid) {
    footer = (
      <>
        <button type="button" className="btn btn-primary" onClick={() => setMode("record")} disabled={busy}>Record payment</button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("edit")} disabled={busy}>Edit</button>
        {!hasPayments && <button type="button" className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={remove} disabled={busy}>Delete</button>}
      </>
    );
  }

  return (
    <Sheet title={title} description={description} onClose={onClose} footer={footer}>
      <div style={{ marginBottom: 18 }}>
        <Status value={state.value}>
          {paid ? `Paid ${formatDate(bill.paid_at)}` : bill.is_draft ? "Draft: residents can't see it yet" : `${state.label} · due ${formatDate(bill.due_date)}`}
        </Status>
      </div>

      <table className="lines">
        <tbody>
          {bill.items.map((item, i) => <tr key={i}><td>{item.title}</td><td>{money(item.amount)}</td></tr>)}
        </tbody>
        <tfoot>
          <tr><td>Total</td><td>{money(bill.total)}</td></tr>
        </tfoot>
      </table>
      <PaidSummary bill={bill} />

      {bill.payments.length > 0 && (
        <>
          <div className="detail-divider" />
          <h3 className="small faint" style={{ fontWeight: 500, marginBottom: 4 }}>Payments</h3>
          <PaymentList payments={bill.payments} canDecide onChanged={reload} />
        </>
      )}

      <div className="detail-divider" />
      <dl className="kv">
        {bill.is_draft && <><dt>Due</dt><dd>{formatDate(bill.due_date)}</dd></>}
        {!bill.is_draft && (
          <>
            <dt>Billed to</dt>
            <dd>
              {bill.billed_to.length
                ? bill.billed_to.map((p) => p.name).join(", ")
                : <span className="faint">
                    Nobody was recorded in this unit when it was sent.
                    {paid ? "" : " A resident who moves in takes it over."}
                  </span>}
            </dd>
            <dt>Sent</dt><dd>{formatDate(bill.sent_at)}</dd>
            <dt>Remark code</dt><dd className="mono">{bill.remark_code}</dd>
            {bill.changed_at && <><dt>Changed</dt><dd>{formatDate(bill.changed_at)} <span className="faint">(residents were notified)</span></dd></>}
          </>
        )}
        {bill.note && <><dt>Note</dt><dd className="prose">{bill.note}</dd></>}
      </dl>

      {paid && <p className="field-hint" style={{ marginTop: 20 }}>Paid bills are locked. Reverse a payment to change it.</p>}
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- Charge lines editor */

const blankLine = () => ({ title: "", amount: "" });

function LineEditor({ lines, setLines, errors, fixedLines = [] }) {
  const update = (i, field, value) => setLines((l) => l.map((x, j) => (j === i ? { ...x, [field]: value } : x)));
  const total = [...fixedLines, ...lines].reduce((n, l) => n + (Number(l.amount) || 0), 0);

  return (
    <div>
      {fixedLines.map((l) => (
        <div key={l.title} className="line-editor">
          <input className="input" value={l.title} disabled aria-label="Charge" />
          <input className="input amount num" value={l.amount} disabled aria-label="Amount" />
          <span />
        </div>
      ))}
      {lines.map((l, i) => (
        <div key={i} className="line-editor">
          <input className={`input ${errors?.[i]?.title ? "invalid" : ""}`} value={l.title} placeholder="e.g. Electricity"
            onChange={(e) => update(i, "title", e.target.value)} aria-label={`Charge ${i + 1}`} />
          <input className={`input amount num ${errors?.[i]?.amount ? "invalid" : ""}`} type="number" min="0" step="0.01"
            inputMode="decimal" value={l.amount} placeholder="0" onChange={(e) => update(i, "amount", e.target.value)}
            aria-label={`Amount for charge ${i + 1}`} />
          <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove charge ${i + 1}`}>
            <CloseIcon />
          </button>
        </div>
      ))}
      <button type="button" className="link small" style={{ marginTop: 10 }} onClick={() => setLines((l) => [...l, blankLine()])}>
        Add a charge
      </button>
      <div className="line-total"><span>Total</span><span>{money(total)}</span></div>
    </div>
  );
}

// Blank rows are ignored; half-filled rows are errors
function checkLines(lines) {
  const used = lines.filter((l) => l.title.trim() || l.amount !== "");
  const errs = used.map((l) => ({
    title: !l.title.trim(),
    amount: l.amount === "" || Number.isNaN(Number(l.amount)) || Number(l.amount) < 0,
  }));
  return { used, errs: errs.some((e) => e.title || e.amount) ? errs : null };
}

const clean = (lines) => lines.map((l) => ({ title: l.title.trim(), amount: String(l.amount) }));

function DueDate({ id, month, value, onChange, error }) {
  return (
    <Field id={id} label="Due date" error={error}>
      <input id={id} type="date" className={`input ${error ? "invalid" : ""}`} value={value} min={dueMin(month)} max={dueMax(month)}
        onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/* ---------------------------------------------------------------- Edit / create */

function EditBillSheet({ bill, title, description, onClose, onSaved }) {
  const [lines, setLines] = useState(bill.items.map((i) => ({ title: i.title, amount: i.amount })));
  const [due, setDue] = useState(bill.due_date);
  const [note, setNote] = useState(bill.note);
  const [lineErrors, setLineErrors] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const { used, errs } = checkLines(lines);
    setLineErrors(errs);
    if (errs) return;
    if (!used.length) {
      setError("A bill needs at least one charge.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await api(API.bill(bill.id), { method: "PATCH", json: { due_date: due, note: note.trim(), items: clean(used) } }));
    } catch (err) {
      setErrors({ due_date: err.field("due_date") });
      if (!err.field("due_date")) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save bill"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      {!bill.is_draft && <div style={{ marginBottom: 16 }}><Alert kind="info">This bill was already sent. Residents will see it marked as updated.</Alert></div>}
      <DueDate id="e-due" month={bill.period} value={due} onChange={setDue} error={errors.due_date} />
      <Field id="e-lines" label="Charges">
        <LineEditor lines={lines} setLines={setLines} errors={lineErrors} />
      </Field>
      <Field id="e-note" label="Note" optional>
        <textarea id="e-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

// Bill one, some or all of the units without a bill this month: each gets its own rent
// plus the shared charges entered here. Bills are drafts unless "send straight away" is ticked.
function BillUnitsSheet({ month, units, onClose, onDone }) {
  const [selected, setSelected] = useState(units.map((u) => u.id));
  const [due, setDue] = useState(dueDefault(month));
  const [withRent, setWithRent] = useState(true);
  const [sendNow, setSendNow] = useState(false);
  const [lines, setLines] = useState([{ title: "Maintenance", amount: "" }]);
  const [note, setNote] = useState("");
  const [lineErrors, setLineErrors] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const count = selected.length;
  const only = count === 1 ? units.find((u) => u.id === selected[0]) : null;

  async function create() {
    if (!count) {
      setError("Choose at least one unit to bill.");
      return;
    }
    const { used, errs } = checkLines(lines);
    setLineErrors(errs);
    if (errs) return;
    if (!used.length && !withRent) {
      setError("Add at least one charge, or include rent.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api(API.bulkBills, {
        method: "POST",
        json: {
          period: month, due_date: due, note: note.trim(), include_rent: withRent, items: clean(used),
          units: selected, send: sendNow,
        },
      }));
    } catch (err) {
      setErrors({ due_date: err.field("due_date") });
      if (!err.field("due_date")) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Bill units"
      description={`${monthLabel(month)} · each unit gets its own bill: its rent plus the charges below.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !count}>
            {busy ? "Creating…" : sendNow ? `Create and send ${plural(count, "bill")}` : `Create ${plural(count, "draft")}`}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <div className="field">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <span className="field-label">Units <span className="optional">({count} of {units.length} selected)</span></span>
          <span className="small" style={{ display: "flex", gap: 12 }}>
            <button type="button" className="link" onClick={() => setSelected(units.map((u) => u.id))}>All</button>
            <button type="button" className="link" onClick={() => setSelected([])}>None</button>
          </span>
        </div>
        <div className="unit-picker-grid compact" role="group" aria-label="Units to bill">
          {units.map((u) => (
            <button key={u.id} type="button" className="unit-option" aria-pressed={selected.includes(u.id)} onClick={() => toggle(u.id)}>
              <strong>{u.name}</strong>
              <span>Floor {u.floor}{u.rent ? ` · ${money(u.rent)}` : ""}</span>
            </button>
          ))}
        </div>
      </div>

      <DueDate id="b-due" month={month} value={due} onChange={setDue} error={errors.due_date} />
      <div className="field" style={{ marginTop: 16 }}>
        <label className="check">
          <input type="checkbox" checked={withRent} onChange={(e) => setWithRent(e.target.checked)} />
          {only
            ? `Start with the unit's rent ${only.rent ? `(${money(only.rent)})` : "(it has none)"}`
            : "Start each bill with the unit's rent"}
        </label>
      </div>
      <Field id="b-lines" label={count === 1 ? "Charges" : "Charges for every selected unit"}
        hint={withRent ? "Total shown excludes rent, which differs per unit." : undefined}>
        <LineEditor lines={lines} setLines={setLines} errors={lineErrors} />
      </Field>
      <Field id="b-note" label="Note" optional>
        <textarea id="b-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="field" style={{ marginTop: 18 }}>
        <label className="check">
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          Send to residents straight away
        </label>
        <span className="field-hint">
          {sendNow
            ? "Residents see the bills as soon as they're created."
            : "Bills stay drafts so you can add per-unit charges like electricity first, then send them all at once."}
        </span>
      </div>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}
