"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import AuthLayout from "../../components/AuthLayout";
import { ArrowRight } from "../../components/Icons";
import BuildingMap from "../../components/BuildingMap";
import CountUp, { GrowBar } from "../../components/CountUp";
import { PhotoField, emptyPhotos } from "../../components/Photos";
import { Alert, Field, Loading, PageHeader } from "../../components/ui";
import { api, API } from "../../lib/api";
import { currentMonth, formatDate, money, monthLabel, plural, timeAgo } from "../../lib/format";
import { useGate, useResource } from "../../lib/hooks";
import { updateUser } from "../../lib/session";

export default function SecretaryOverview() {
  const user = useGate("secretary");
  const { data, error, setData } = useResource(user ? API.building : null);

  if (!user) return null;
  if (data && !data.building) {
    return <SetupBuilding onCreated={(building) => setData({ building })} />;
  }

  return (
    <AppShell user={user}>
      <div className="page">
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}
        {data?.building && <Dashboard />}
      </div>
    </AppShell>
  );
}

const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : 0);

function Dashboard() {
  const { data: d, error } = useResource(API.dashboard);

  if (error) return <Alert>{error}</Alert>;
  if (!d) return <Loading />;

  const b = d.building;
  const c = d.collection;
  const o = d.occupancy;

  // Things to act on, most urgent first; only what actually needs doing
  const todos = [];
  if (c.overdue_bills) {
    todos.push({ href: "/secretary/bills", figure: c.overdue_bills, urgent: true,
      title: `Overdue ${c.overdue_bills === 1 ? "bill" : "bills"}`,
      text: `${money(c.overdue_total)} owed · the oldest is ${c.oldest_overdue_days} ${c.oldest_overdue_days === 1 ? "day" : "days"} late` });
  }
  if (o.units === 0) {
    todos.push({ href: "/secretary/building", figure: "—", title: "Add your units", text: "Residents choose their unit from this list when they join" });
  }
  if (c.drafts) {
    todos.push({ href: "/secretary/bills", figure: c.drafts, title: `Draft ${c.drafts === 1 ? "bill" : "bills"} not sent for ${monthLabel(c.period)}`, text: "Residents can't see them until you send them" });
  }
  if (o.units && c.unbilled_units) {
    todos.push({ href: "/secretary/bills", figure: c.unbilled_units, title: `${c.unbilled_units === 1 ? "Unit" : "Units"} not billed for ${monthLabel(c.period)}`, text: `${o.units - c.unbilled_units} of ${o.units} billed so far` });
  }
  if (o.residents_without_unit) {
    todos.push({ href: "/secretary/people", figure: o.residents_without_unit, title: `${o.residents_without_unit === 1 ? "Resident hasn't" : "Residents haven't"} chosen a unit`, text: "You can set it for them on the People page" });
  }
  if (!b.guards) {
    todos.push({ href: "/secretary/people", figure: "—", title: "No guards yet", text: "Add a guard on the People page" });
  }

  const complaintsOpen = d.complaints.open;

  return (
    <>
      <PageHeader
        title={b.name}
        description={`${plural(b.floors, "floor")} · ${plural(o.units, "unit")} · ${plural(b.residents, "resident")} · ${plural(b.guards, "guard")}`}
      />

      <CollectionHero c={c} />

      <BuildingMap map={d.map} />

      <div className="dash-grid">
        <section className="section">
          <div className="section-head"><h2>Needs attention</h2></div>
          <div className="panel">
            {todos.length === 0 ? (
              <p className="all-clear">You&apos;re all caught up.</p>
            ) : (
              <ul className="rows">
                {todos.map((t) => (
                  <li key={t.title}>
                    <Link href={t.href} className="todo">
                      <span className="todo-figure" style={t.urgent ? { color: "var(--red)" } : undefined}>{t.figure}</span>
                      <span className="todo-text"><strong>{t.title}</strong><span>{t.text}</span></span>
                      <span className="todo-arrow"><ArrowRight /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="dash-side">
          <section className="section">
            <div className="section-head"><h2>At the gate</h2><Link href="/secretary/visitors" className="link small">Visitors</Link></div>
            <div className="panel panel-pad">
              <dl className="facts">
                <div><dt>Inside now</dt><dd>{d.gate.inside_now}</dd></div>
                <div><dt>Entries today</dt><dd>{d.gate.entries_today}</dd></div>
              </dl>
              {d.gate.long_stays > 0 && (
                <p className="small" style={{ marginTop: 12, color: "var(--red)" }}>
                  {plural(d.gate.long_stays, "person", "people")} inside for over 12 hours, likely not checked out
                </p>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head"><h2>Complaints</h2><Link href="/secretary/complaints" className="link small">Complaints</Link></div>
            <div className="panel panel-pad">
              <dl className="facts">
                <div><dt>Open</dt><dd>{d.complaints.open}</dd></div>
                <div><dt>Resolved, 30 days</dt><dd>{d.complaints.resolved_last_30_days}</dd></div>
              </dl>
              {d.complaints.oldest && (
                <p className="small muted" style={{ marginTop: 12 }}>
                  Oldest: <Link href={`/secretary/complaints?id=${d.complaints.oldest.id}`} className="link">{d.complaints.oldest.title}</Link>
                  {", "}waiting {d.complaints.oldest.days === 0 ? "since today" : `${plural(d.complaints.oldest.days, "day")}`}
                </p>
              )}
              {d.complaints.typical_days_to_resolve !== null && (
                <p className="small faint" style={{ marginTop: 4 }}>
                  Usually resolved in {d.complaints.typical_days_to_resolve < 1 ? "under a day" : plural(Math.round(d.complaints.typical_days_to_resolve), "day")}
                </p>
              )}
              {!complaintsOpen && !d.complaints.oldest && <p className="small muted" style={{ marginTop: 12 }}>Nothing waiting.</p>}
            </div>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="section-head"><h2>Latest notices</h2><Link href="/secretary/notices" className="link small">All notices</Link></div>
        <div className="panel">
          {d.notices.length === 0 ? (
            <p className="all-clear">Nothing posted yet. <Link href="/secretary/notices" className="link">Post a notice</Link></p>
          ) : (
            <ul className="rows">
              {d.notices.map((n) => (
                <li key={n.id}>
                  <Link href={`/secretary/notices?id=${n.id}`} className="row">
                    <span className="row-main">
                      <span className="row-title">{n.title}</span>
                      <span className="row-sub">{n.message}</span>
                    </span>
                    <span className="row-end">{timeAgo(n.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

// This month's collection: how much is in, how fast, and how that compares with last month
function CollectionHero({ c }) {
  const share = pct(c.collected, c.billed);
  const billed = Number(c.billed) > 0;

  // Pace: days left until the bills are due, or how long ago that passed
  let pace = null;
  if (billed && c.due_date) {
    const days = Math.round((new Date(`${c.due_date}T00:00:00`) - new Date(new Date().toDateString())) / 86_400_000);
    pace = days > 0
      ? `${plural(days, "day")} until due (${formatDate(c.due_date)})`
      : days === 0 ? "Due today" : `Due date passed ${plural(-days, "day")} ago`;
  }

  // Like-for-like: last month's collection by the same day of the month
  let compare = null;
  if (billed && c.last_month) {
    const before = pct(c.last_month.collected_by_same_day, c.last_month.billed);
    const diff = share - before;
    const name = new Date(`${c.last_month.period}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long" });
    compare = {
      tone: diff >= 1 ? "ahead" : diff <= -1 ? "behind" : "level",
      text: diff >= 1
        ? `↑ ${diff} points ahead of ${name} at this point`
        : diff <= -1
          ? `↓ ${-diff} points behind ${name} at this point`
          : `Level with ${name} at this point`,
      detail: `${name} was ${before}% collected by ${formatDate(c.last_month.same_day)}`,
    };
  }

  return (
    <section className="panel panel-pad collection">
      <div className="collection-head">
        <div>
          <div className="small faint">{monthLabel(c.period)} collection</div>
          <div className="collection-figure">
            <CountUp value={c.collected} format={(n) => money(Math.round(n))} />{" "}
            <span className="muted">of {money(c.billed)} collected</span>
          </div>
        </div>
        <div className="collection-side">
          {billed && <div className="collection-pct"><CountUp value={share} format={(n) => `${Math.round(n)}%`} /></div>}
          {pace && <div className="small muted">{pace}</div>}
        </div>
      </div>

      {billed ? (
        <>
          <div className="meter" role="img" aria-label={`${share}% collected`}>
            <GrowBar percent={share} />
          </div>
          <div className="summary-line" style={{ marginTop: 12, marginBottom: 0 }}>
            <span>{c.paid_bills} of {plural(c.sent_bills, "bill")} paid</span>
            <span><b>{money(c.outstanding)}</b> outstanding this month</span>
            {c.overdue_bills > 0 && <span style={{ color: "var(--red)" }}><b style={{ color: "inherit" }}>{money(c.overdue_total)}</b> overdue overall</span>}
            <Link href="/secretary/bills" className="link" style={{ marginLeft: "auto" }}>Bills</Link>
          </div>
          {compare && (
            <p className={`compare compare-${compare.tone}`} title={compare.detail}>
              {compare.text} <span className="faint">· {compare.detail}</span>
            </p>
          )}
        </>
      ) : (
        <p className="small muted" style={{ marginTop: 8 }}>
          Nothing sent for {monthLabel(c.period)} yet.{c.drafts ? ` ${plural(c.drafts, "draft")} waiting to be sent.` : ""}{" "}
          <Link href="/secretary/bills" className="link">Bills</Link>
        </p>
      )}
    </section>
  );
}

// First sign-in: the secretary describes their building
function SetupBuilding({ onCreated }) {
  const [form, setForm] = useState({ name: "", total_floors: "", description: "" });
  const [photos, setPhotos] = useState(emptyPhotos());
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = "Enter the building's name.";
    const floors = Number(form.total_floors);
    if (!Number.isInteger(floors) || floors < 1) errs.total_floors = "Enter a whole number, 1 or more.";
    else if (floors > 200) errs.total_floors = "That's a lot of floors. Check the number.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = new FormData();
    body.append("name", form.name.trim());
    body.append("total_floors", String(floors));
    body.append("description", form.description.trim());
    photos.added.forEach((p) => body.append("photos", p.file));

    setBusy(true);
    setError(null);
    try {
      const building = await api(API.createBuilding, { method: "POST", form: body });
      updateUser({ building: { id: building.id, name: building.name } });
      onCreated(building);
    } catch (err) {
      setErrors({ name: err.field("name"), total_floors: err.field("total_floors") });
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Set up your building</h1>
      <p className="lead">
        Floors are created for you. Afterwards you&apos;ll add units and get a join code for residents and guards.
      </p>
      <form onSubmit={submit} noValidate>
        <Field id="name" label="Building name" error={errors.name}>
          <input id="name" className={`input ${errors.name ? "invalid" : ""}`} value={form.name} onChange={set("name")}
            placeholder="Sunrise Apartments" autoFocus />
        </Field>
        <Field id="floors" label="Number of floors" error={errors.total_floors} hint="This can't be changed later.">
          <input id="floors" type="number" min="1" inputMode="numeric" className={`input ${errors.total_floors ? "invalid" : ""}`}
            value={form.total_floors} onChange={set("total_floors")} />
        </Field>
        <Field id="description" label="Description" optional>
          <textarea id="description" className="textarea" value={form.description} onChange={set("description")}
            placeholder="Address, landmarks, anything residents should know" />
        </Field>
        <Field id="photos" label="Photos" optional>
          <PhotoField id="photos" value={photos} onChange={setPhotos} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating…" : "Create building"}
        </button>
        {error && <div style={{ marginTop: 12 }}><Alert>{error}</Alert></div>}
      </form>
    </AuthLayout>
  );
}
