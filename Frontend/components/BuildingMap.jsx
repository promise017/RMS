"use client";

import { useState } from "react";
import Link from "next/link";
import { Segmented, Sheet, Status } from "./ui";
import { formatDate, money, monthLabel, plural } from "../lib/format";

const MODES = [
  { value: "bills", label: "Bills" },
  { value: "occupancy", label: "Occupancy" },
  { value: "complaints", label: "Complaints" },
];

// What each unit looks like in each mode: a tone (colour) and a short line of text
function look(unit, mode) {
  const vacant = unit.residents.length === 0;
  if (mode === "occupancy") {
    return vacant
      ? { tone: "vacant", key: "vacant", text: "Vacant" }
      : { tone: "occupied", key: "occupied", text: plural(unit.residents.length, "resident") };
  }
  if (mode === "complaints") {
    return unit.open_complaints
      ? { tone: "red", key: "complaints", text: `${unit.open_complaints} open` }
      : { tone: vacant ? "vacant" : "plain", key: "none", text: vacant ? "Vacant" : "None" };
  }
  const state = unit.bill?.state;
  if (state === "paid") return { tone: "green", key: "paid", text: "Paid" };
  if (state === "overdue") return { tone: "red", key: "overdue", text: money(unit.bill.total) };
  if (state === "unpaid") return { tone: "amber", key: "unpaid", text: money(unit.bill.total) };
  if (state === "draft") return { tone: "plain", key: "draft", text: "Draft" };
  return vacant ? { tone: "vacant", key: "vacant", text: "Vacant" } : { tone: "plain", key: "unbilled", text: "Not billed" };
}

const LEGENDS = {
  bills: [
    { key: "paid", tone: "green", label: "Paid" },
    { key: "unpaid", tone: "amber", label: "Unpaid" },
    { key: "overdue", tone: "red", label: "Overdue" },
    { key: "draft", tone: "plain", label: "Draft" },
    { key: "unbilled", tone: "plain", label: "Not billed" },
    { key: "vacant", tone: "vacant", label: "Vacant" },
  ],
  occupancy: [
    { key: "occupied", tone: "occupied", label: "Occupied" },
    { key: "vacant", tone: "vacant", label: "Vacant" },
  ],
  complaints: [
    { key: "complaints", tone: "red", label: "Open complaints" },
    { key: "none", tone: "plain", label: "None" },
  ],
};

// The whole building at a glance: floors as rows (top floor first), units as tiles
export default function BuildingMap({ map }) {
  const [mode, setMode] = useState("bills");
  const [openId, setOpenId] = useState(null);

  const units = map.floors.flatMap((f) => f.units.map((u) => ({ ...u, floor: f.number })));
  const counts = {};
  units.forEach((u) => {
    const k = look(u, mode).key;
    counts[k] = (counts[k] ?? 0) + 1;
  });
  const open = units.find((u) => u.id === openId);

  return (
    <section className="section">
      <div className="section-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h2>Building map</h2>
          <p>{mode === "bills" ? `${monthLabel(map.period)} bills, unit by unit. ` : ""}Select a unit for details.</p>
        </div>
        <Segmented label="Colour units by" value={mode} onChange={setMode} options={MODES} />
      </div>

      <div className="panel panel-pad">
        {units.length === 0 ? (
          <p className="small muted">Add units on the Building page to see the map.</p>
        ) : (
          <>
            <div className="bmap" role="list" aria-label="Units by floor">
              {map.floors.map((floor) => (
                <div key={floor.number} className="bmap-floor" role="listitem">
                  <span className="bmap-label">Floor {floor.number}</span>
                  <div className="bmap-units">
                    {floor.units.length === 0 && <span className="small faint">No units</span>}
                    {floor.units.map((u) => {
                      const l = look(u, mode);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          className={`bmap-unit tone-${l.tone}`}
                          aria-label={`Unit ${u.name}, floor ${floor.number}: ${l.text}`}
                          aria-haspopup="dialog"
                          onClick={() => setOpenId(u.id)}
                        >
                          <strong>{u.name}</strong>
                          <span>{l.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <ul className="bmap-legend" aria-label="Legend">
              {LEGENDS[mode].filter((item) => counts[item.key]).map((item) => (
                <li key={item.key}>
                  <span className={`bmap-swatch tone-${item.tone}`} aria-hidden="true" />
                  {item.label} <span className="faint num">{counts[item.key]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {open && <UnitSheet unit={open} period={map.period} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function UnitSheet({ unit, period, onClose }) {
  const state = unit.bill?.state;
  const owed = Number(unit.owed);

  return (
    <Sheet
      title={`Unit ${unit.name}`}
      description={`Floor ${unit.floor} · ${unit.area} sq.ft · ${unit.rent ? `${money(unit.rent)} rent` : "no rent"}`}
      onClose={onClose}
      footer={
        <>
          <Link href="/secretary/bills" className="btn btn-secondary">Bills</Link>
          <Link href="/secretary/building" className="btn btn-quiet">Building</Link>
        </>
      }
    >
      <h3 className="small faint" style={{ fontWeight: 500, marginBottom: 8 }}>Residents</h3>
      {unit.residents.length === 0 ? (
        <p className="muted">Vacant: nobody has chosen this unit.</p>
      ) : (
        <ul className="rows" style={{ marginBottom: 4 }}>
          {unit.residents.map((r) => (
            <li key={r.id} className="row" style={{ padding: "8px 0", minHeight: 0 }}>
              <span className="row-main">
                <span className="row-title">{r.name}</span>
                {r.moved_in && <span className="row-sub">Moved in {formatDate(r.moved_in)}</span>}
              </span>
              {r.phone && <a href={`tel:${r.phone}`} className="btn btn-secondary btn-sm">Call {r.phone}</a>}
            </li>
          ))}
        </ul>
      )}

      <div className="detail-divider" />
      <dl className="kv">
        <dt>{monthLabel(period)}</dt>
        <dd>
          {!unit.bill ? <span className="faint">Not billed</span> : (
            <>
              <Status value={state === "paid" ? "paid" : state === "overdue" ? "overdue" : state === "draft" ? "draft" : "unpaid"}>
                {state === "draft" ? "Draft, not sent" : state === "paid" ? "Paid" : state === "overdue" ? "Overdue" : "Unpaid"}
              </Status>
              <span className="num" style={{ marginLeft: 10 }}>{money(unit.bill.total)}</span>
              {state !== "paid" && state !== "draft" && <span className="faint"> · due {formatDate(unit.bill.due_date)}</span>}
            </>
          )}
        </dd>
        <dt>Owes</dt>
        <dd>
          {owed > 0 ? (
            <>
              <span className="num" style={{ fontWeight: 600 }}>{money(unit.owed)}</span>
              <span className="faint"> across {plural(unit.unpaid_bills, "bill")}</span>
              {Number(unit.owed_overdue) > 0 && <div className="small" style={{ color: "var(--red)" }}>{money(unit.owed_overdue)} overdue</div>}
            </>
          ) : <span className="muted">Nothing</span>}
        </dd>
        <dt>Complaints</dt>
        <dd>
          {unit.open_complaints
            ? <Link href="/secretary/complaints" className="link">{plural(unit.open_complaints, "open complaint")}</Link>
            : <span className="muted">None open</span>}
        </dd>
      </dl>
      <p className="field-hint" style={{ marginTop: 14 }}>Anonymous complaints are never shown against a unit.</p>
    </Sheet>
  );
}
