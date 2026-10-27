"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "./Icons";
import { Alert, Empty, Field, Loading, PageHeader, Segmented, Sheet, Status } from "./ui";
import { api, API } from "../lib/api";
import { dayLabel, duration, formatTime, localDay, plural, shiftDay, unitLabel } from "../lib/format";
import { useResource } from "../lib/hooks";

const TYPES = [
  { value: "visitor", label: "Visitor" },
  { value: "worker", label: "Worker" },
  { value: "delivery", label: "Delivery" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

// One-tap purposes for each kind of entry
const PURPOSES = {
  visitor: ["Guest", "Family", "Friend", "Meeting"],
  worker: ["Maid", "Cook", "Driver", "Cleaner", "Plumber", "Electrician"],
  delivery: ["Food", "Parcel", "Courier", "Groceries"],
};

const LONG_STAY_HOURS = 12;

// "4:42 pm", "yesterday 4:42 pm" or "Mon 26 Oct, 4:42 pm"
function since(iso) {
  const day = localDay(new Date(iso));
  if (day === localDay()) return formatTime(iso);
  if (day === shiftDay(localDay(), -1)) return `yesterday ${formatTime(iso)}`;
  return `${dayLabel(day)}, ${formatTime(iso)}`;
}
const visiting = (e) => (e.unit_info ? unitLabel(e.unit_info) : "Building");

/**
 * The building's visitor log.
 * Guards (canLog) check people in and out; the secretary only reads it.
 */
export default function VisitorLog({ canLog, buildingName }) {
  const [view, setView] = useState(canLog ? "inside" : "day");
  const [day, setDay] = useState(localDay);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [note, setNote] = useState(null);

  // Wait a moment after typing before searching
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const params = new URLSearchParams(view === "inside" ? { inside: "true" } : { date: day });
  if (search) params.set("q", search);
  const log = useResource(`${API.visitors}?${params}`);
  const inside = useResource(`${API.visitors}?inside=true`); // for the count on the tab

  // Keep "time inside" fresh on the Inside view
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  function refresh() {
    log.reload();
    inside.reload();
  }

  return (
    <>
      <PageHeader
        eyebrow={buildingName}
        title="Visitors"
        description={canLog ? "Check people in at the gate and out when they leave." : "Everyone the guards let in, and when they left."}
        actions={canLog && (
          <button type="button" className="btn btn-primary" onClick={() => { setCheckingIn(true); setNote(null); }}>Check in</button>
        )}
      />

      <div className="section-head" style={{ flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "inside", label: "Inside now", count: inside.data?.length },
              { value: "day", label: "By day" },
            ]}
          />
          {view === "day" && (
            <div className="month-nav">
              <button type="button" className="icon-btn" onClick={() => setDay((d) => shiftDay(d, -1))} aria-label="Previous day"><ChevronLeft /></button>
              <strong style={{ minWidth: 150 }}>{dayLabel(day)}</strong>
              <button type="button" className="icon-btn" onClick={() => setDay((d) => shiftDay(d, 1))} disabled={day >= localDay()}
                aria-label="Next day"><ChevronRight /></button>
            </div>
          )}
        </div>
        <input type="search" className="input" style={{ maxWidth: 260 }} placeholder="Search name, phone, vehicle, unit"
          value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the visitor log" />
      </div>

      {note && <div style={{ marginBottom: 12 }}><Alert kind={note.kind}>{note.text}</Alert></div>}
      {log.error && <Alert>{log.error}</Alert>}

      <div className="panel">
        {!log.data ? <Loading /> : view === "inside" ? (
          <InsideList
            entries={log.data}
            canLog={canLog}
            searching={!!search}
            onCheckedOut={(e) => { setNote({ kind: "ok", text: `${e.name} checked out after ${duration(e.check_in, e.check_out)}.` }); refresh(); }}
            onError={(text) => setNote({ kind: "error", text })}
          />
        ) : (
          <DayTable entries={log.data} day={day} searching={!!search} />
        )}
      </div>

      {checkingIn && (
        <CheckInSheet
          onClose={() => setCheckingIn(false)}
          onDone={(e) => {
            setCheckingIn(false);
            setView("inside");
            setNote({ kind: "ok", text: `${e.name} checked in at ${formatTime(e.check_in)}.` });
            refresh();
          }}
        />
      )}
    </>
  );
}

function InsideList({ entries, canLog, searching, onCheckedOut, onError }) {
  const [busyId, setBusyId] = useState(null);

  async function checkOut(e) {
    setBusyId(e.id);
    try {
      onCheckedOut(await api(API.checkOut(e.id), { method: "POST" }));
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!entries.length) {
    return <Empty title={searching ? "Nobody inside matches" : "Nobody is inside"}>{!searching && canLog && "People you check in show up here until they leave."}</Empty>;
  }

  return (
    <ul className="rows">
      {entries.map((e) => {
        const longStay = (Date.now() - new Date(e.check_in)) / 3_600_000 > LONG_STAY_HOURS;
        return (
          <li key={e.id} className="row visit-row">
            <span className="row-main">
              <span className="row-title">{e.name}</span>
              <span className="row-sub">
                {[TYPE_LABEL[e.entry_type], `to ${visiting(e)}`, e.purpose, e.vehicle_no, e.phone].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="row-end">
              <span className={`small ${longStay ? "" : "muted"}`} style={longStay ? { color: "var(--red)" } : undefined}
                title={`Checked in at ${formatTime(e.check_in)}`}>
                {longStay ? `Inside ${duration(e.check_in)}, since ${since(e.check_in)}` : `In at ${formatTime(e.check_in)} · ${duration(e.check_in)}`}
              </span>
              {canLog && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => checkOut(e)} disabled={busyId === e.id}>
                  {busyId === e.id ? "…" : "Check out"}
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DayTable({ entries, day, searching }) {
  if (!entries.length) {
    return <Empty title={searching ? "No matches" : `Nobody came in ${dayLabel(day) === "Today" ? "today" : "that day"}`} />;
  }
  const people = entries.length;
  const stillIn = entries.filter((e) => e.is_inside).length;

  return (
    <>
      <p className="small muted" style={{ padding: "12px 16px 0" }}>
        {plural(people, "entry", "entries")}{stillIn ? ` · ${stillIn} still inside` : ""}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>In</th><th>Out</th><th>Name</th><th className="hide-sm">Type</th><th>Visiting</th>
              <th className="hide-sm">Vehicle</th><th className="hide-sm">Let in by</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="num">{formatTime(e.check_in)}</td>
                <td className="num">
                  {e.check_out
                    ? <span title={e.checked_out_by ? `Checked out by ${e.checked_out_by}` : undefined}>{formatTime(e.check_out)}</span>
                    : <Status value="in_progress">Inside</Status>}
                </td>
                <td>
                  <div className="cell-strong">{e.name}</div>
                  <div className="tiny faint">{[e.phone, e.purpose].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="hide-sm muted">{TYPE_LABEL[e.entry_type]}</td>
                <td>{visiting(e)}</td>
                <td className="hide-sm muted num">{e.vehicle_no || "—"}</td>
                <td className="hide-sm muted">{e.logged_by ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const EMPTY = { entry_type: "visitor", phone: "", name: "", unit: "", purpose: "", vehicle_no: "" };

function CheckInSheet({ onClose, onDone }) {
  const units = useResource(API.gateUnits);
  const [form, setForm] = useState(EMPTY);
  const [known, setKnown] = useState(null); // details from this phone's previous visit
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name, value) => setForm((f) => ({ ...f, [name]: value }));

  // A phone number that has been here before fills in the rest
  useEffect(() => {
    const phone = form.phone.replace(/[\s-]/g, "");
    if (phone.length < 7) {
      setKnown(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const found = await api(`${API.visitorLookup}?phone=${encodeURIComponent(phone)}`);
        if (!found.found) {
          setKnown(null);
          return;
        }
        setKnown(found);
        setForm((f) => ({
          ...f,
          name: f.name || found.name,
          entry_type: found.entry_type,
          unit: f.unit || (found.unit ? String(found.unit) : ""),
          purpose: f.purpose || found.purpose,
          vehicle_no: f.vehicle_no || found.vehicle_no,
        }));
      } catch { /* the lookup is only a convenience */ }
    }, 400);
    return () => clearTimeout(t);
  }, [form.phone]);

  async function submit(e) {
    e?.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = form.entry_type === "delivery" ? "Enter the company or person's name." : "Enter their name.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      const entry = await api(API.visitors, {
        method: "POST",
        json: { ...form, unit: form.unit ? Number(form.unit) : null },
      });
      onDone(entry);
    } catch (err) {
      const fieldErrs = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, err.field(k)]).filter(([, v]) => v));
      setErrors(fieldErrs);
      if (!Object.keys(fieldErrs).length) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Check in"
      description="Their check-in time is recorded automatically."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Checking in…" : "Check in"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <div className="field">
          <span className="field-label">Who is it?</span>
          <Segmented label="Type" value={form.entry_type} onChange={(v) => set("entry_type", v)} options={TYPES} />
        </div>

        <Field id="v-phone" label="Phone" optional error={errors.phone}
          hint={known ? `Been here ${plural(known.visits, "time")} before. Details filled in.` : "If they've been here before, the rest fills in."}>
          <input id="v-phone" type="tel" inputMode="tel" className={`input ${errors.phone ? "invalid" : ""}`} value={form.phone}
            onChange={(e) => set("phone", e.target.value)} placeholder="98XXXXXXXX" autoComplete="off" autoFocus />
        </Field>

        <Field id="v-name" label={form.entry_type === "delivery" ? "Name or company" : "Name"} error={errors.name}>
          <input id="v-name" className={`input ${errors.name ? "invalid" : ""}`} value={form.name}
            onChange={(e) => set("name", e.target.value)} placeholder={form.entry_type === "delivery" ? "Daraz, Foodmandu, Pathao…" : "Full name"}
            autoComplete="off" />
        </Field>

        <Field id="v-unit" label="Visiting" optional error={errors.unit}>
          <select id="v-unit" className="select" value={form.unit} onChange={(e) => set("unit", e.target.value)} disabled={!units.data}>
            <option value="">Building / common area</option>
            {units.data?.floors.filter((f) => f.units.length).map((f) => (
              <optgroup key={f.number} label={`Floor ${f.number}`}>
                {f.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field id="v-purpose" label="Purpose" optional error={errors.purpose}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {PURPOSES[form.entry_type].map((p) => (
              <button key={p} type="button" className={`btn btn-sm ${form.purpose === p ? "btn-primary" : "btn-secondary"}`}
                onClick={() => set("purpose", form.purpose === p ? "" : p)} aria-pressed={form.purpose === p}>
                {p}
              </button>
            ))}
          </div>
          <input id="v-purpose" className="input" value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Or type it" />
        </Field>

        <Field id="v-vehicle" label="Vehicle number" optional error={errors.vehicle_no}>
          <input id="v-vehicle" className="input" value={form.vehicle_no} onChange={(e) => set("vehicle_no", e.target.value)}
            placeholder="BA 2 PA 1234" autoComplete="off" style={{ textTransform: "uppercase" }} />
        </Field>
        <button type="submit" hidden />
      </form>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}
