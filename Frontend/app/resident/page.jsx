"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import { ArrowRight } from "../../components/Icons";
import { Gallery } from "../../components/Photos";
import { Alert, Empty, Loading, PageHeader } from "../../components/ui";
import { api, API } from "../../lib/api";
import { formatDate, money, monthLabel, plural, timeAgo } from "../../lib/format";
import { useGate, useResource } from "../../lib/hooks";

export default function ResidentHome() {
  const user = useGate("resident");
  const { data, error, setData } = useResource(user ? API.myUnit : null);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <div className="page">
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}
        {data && (data.unit ? <Home data={data} /> : <UnitPicker building={data.building} onChosen={setData} />)}
      </div>
    </AppShell>
  );
}

function Home({ data }) {
  const { unit, building } = data;
  const bills = useResource(API.myBills);
  const notices = useResource(API.buildingNotices);

  const unpaid = bills.data?.filter((b) => b.status === "unpaid") ?? [];
  const owed = unpaid.reduce((n, b) => n + Number(b.balance), 0);
  const overdue = unpaid.filter((b) => b.is_overdue);
  const nextDue = [...unpaid].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const latest = notices.data?.[0];

  return (
    <>
      <PageHeader
        eyebrow={building.name}
        title={`Unit ${unit.name}`}
        description={`Floor ${unit.floor}${data.moved_in ? ` · Moved in ${formatDate(data.moved_in)}` : ""}`}
      />

      <div className="unit-hero">
        <div>
          {unit.images.length ? <Gallery photos={unit.images} /> : (
            <div className="panel"><Empty>Your secretary hasn&apos;t added photos of this unit yet.</Empty></div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel panel-pad">
            <dl className="facts">
              <div><dt>Area</dt><dd>{unit.area} sq.ft</dd></div>
              <div><dt>Rent</dt><dd>{unit.rent ? money(unit.rent) : "None"}</dd></div>
            </dl>
          </div>

          <div className="panel">
            {!bills.data ? <Loading /> : (
              <Link href="/resident/bills" className="bill-callout">
                <div>
                  <div className="small" style={{ color: overdue.length ? "var(--red)" : "var(--ink-3)" }}>
                    {overdue.length ? `${plural(overdue.length, "bill")} overdue` : unpaid.length ? `${plural(unpaid.length, "bill")} unpaid` : "Bills"}
                  </div>
                  <div className="amount" style={overdue.length ? { color: "var(--red)" } : undefined}>{unpaid.length ? money(owed) : "All paid"}</div>
                  {nextDue && (
                    <div className="small muted">
                      {nextDue.is_overdue
                        ? `${monthLabel(nextDue.period)} was due ${formatDate(nextDue.due_date)}`
                        : nextDue.due_soon
                          ? `${monthLabel(nextDue.period)} is due ${nextDue.days_until_due === 0 ? "today" : nextDue.days_until_due === 1 ? "tomorrow" : `in ${nextDue.days_until_due} days`}`
                          : `Next due ${formatDate(nextDue.due_date)} · ${monthLabel(nextDue.period)}`}
                    </div>
                  )}
                  {!unpaid.length && bills.data.length === 0 && <div className="small muted">No bills yet</div>}
                </div>
                <span className="todo-arrow"><ArrowRight /></span>
              </Link>
            )}
          </div>

          {latest && (
            <div className="panel">
              <Link href="/resident/notices" className="bill-callout">
                <div style={{ minWidth: 0 }}>
                  <div className="small faint">Latest notice · {timeAgo(latest.created_at)}</div>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latest.title}</div>
                </div>
                <span className="todo-arrow"><ArrowRight /></span>
              </Link>
            </div>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head"><h2>About {building.name}</h2></div>
        {building.description ? <p className="prose muted" style={{ maxWidth: 640 }}>{building.description}</p> : null}
        <p className="small faint" style={{ marginTop: building.description ? 8 : 0 }}>{plural(building.total_floors, "floor")}</p>
        {building.images.length > 0 && <div style={{ marginTop: 16, maxWidth: 640 }}><Gallery photos={building.images} /></div>}
      </section>
    </>
  );
}

// First visit: the resident finds and confirms their own unit (once; the secretary can correct it)
function UnitPicker({ building, onChosen }) {
  const { data, error } = useResource(API.unitChoices);
  const [floorNo, setFloorNo] = useState(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const floors = useMemo(() => data?.floors.filter((f) => f.units.length) ?? [], [data]);
  const currentFloor = floorNo ?? floors[0]?.number;

  async function confirm() {
    setBusy(true);
    setSaveError(null);
    try {
      onChosen(await api(API.myUnit, { method: "POST", json: { unit: picked.id } }));
    } catch (err) {
      setSaveError(err.field("unit") || err.message);
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? floors.flatMap((f) => f.units.filter((u) => u.name.toLowerCase().includes(q)).map((u) => ({ ...u, floor: f.number })))
    : (floors.find((f) => f.number === currentFloor)?.units ?? []).map((u) => ({ ...u, floor: currentFloor }));

  return (
    <div className="page-narrow">
      <PageHeader
        eyebrow={building.name}
        title="Which unit do you live in?"
        description="Choose it once. If you pick the wrong one, your secretary can change it."
      />

      {error && <Alert>{error}</Alert>}
      {!error && !data && <Loading />}
      {data && floors.length === 0 && (
        <div className="panel"><Empty title="No units yet">Your secretary hasn&apos;t added the building&apos;s units. Check back later.</Empty></div>
      )}

      {floors.length > 0 && (
        <>
          <div className="field-row" style={{ marginBottom: 16 }}>
            <div className="field">
              <label className="field-label" htmlFor="pick-floor">Floor</label>
              <select id="pick-floor" className="select" value={currentFloor} disabled={!!q}
                onChange={(e) => { setFloorNo(Number(e.target.value)); setPicked(null); }}>
                {floors.map((f) => <option key={f.number} value={f.number}>Floor {f.number}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="pick-search">Or search every floor</label>
              <input id="pick-search" type="search" className="input" placeholder="Unit name, e.g. 2A" value={query}
                onChange={(e) => { setQuery(e.target.value); setPicked(null); }} />
            </div>
          </div>

          {shown.length ? (
            <div className="unit-picker-grid" role="group" aria-label="Units">
              {shown.map((u) => (
                <button key={u.id} type="button" className="unit-option" aria-pressed={picked?.id === u.id} onClick={() => setPicked(u)}>
                  <strong>{u.name}</strong>
                  <span>{q ? `Floor ${u.floor} · ` : ""}{u.area} sq.ft</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No unit matches “{query}”.</p>
          )}

          {picked && (
            <div className="panel panel-pad" style={{ marginTop: 24, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Unit {picked.name}, floor {picked.floor}</div>
                <div className="small muted">{picked.area} sq.ft</div>
              </div>
              <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
                {busy ? "Saving…" : "This is my unit"}
              </button>
            </div>
          )}
          {saveError && <div style={{ marginTop: 12 }}><Alert>{saveError}</Alert></div>}
        </>
      )}
    </div>
  );
}
