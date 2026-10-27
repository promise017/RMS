"use client";

import { useEffect, useState } from "react";
import AppShell from "../../../components/AppShell";
import { Gallery, PhotoField, emptyPhotos } from "../../../components/Photos";
import { Alert, BillStatus, Empty, Field, Loading, PageHeader, Sheet } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { money, monthLabel, plural } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";
import { updateUser } from "../../../lib/session";

export default function BuildingPage() {
  const user = useGate("secretary");
  if (!user) return null;
  return (
    <AppShell user={user}>
      <div className="page">
        <PageHeader title="Building" description="Details residents see, and the units they choose from when they join." />
        <Details />
        <FloorsAndUnits />
      </div>
    </AppShell>
  );
}

// Upload new photos with the main save, then delete the ones marked for removal
async function syncRemovedPhotos(removed, urlFor) {
  let last = null;
  for (const id of removed) last = await api(urlFor(id), { method: "DELETE" });
  return last;
}

/* ---------------------------------------------------------------- Details */

function Details() {
  const { data, error, setData } = useResource(API.building);
  const [editing, setEditing] = useState(false);
  const building = data?.building;

  if (error) return <Alert>{error}</Alert>;
  if (!building) return <Loading />;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Details</h2>
        {!editing && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      <div className="panel panel-pad">
        {editing ? (
          <DetailsForm
            building={building}
            onCancel={() => setEditing(false)}
            onSaved={(b) => {
              setData({ building: b });
              updateUser({ building: { id: b.id, name: b.name } });
              setEditing(false);
            }}
          />
        ) : (
          <>
            <dl className="kv">
              <dt>Name</dt><dd>{building.name}</dd>
              <dt>Floors</dt><dd>{building.total_floors}</dd>
              <dt>Description</dt>
              <dd className={building.description ? "prose" : "faint"}>{building.description || "No description yet"}</dd>
            </dl>
            {building.images.length > 0 && <div style={{ marginTop: 20 }}><Gallery photos={building.images} /></div>}
          </>
        )}
      </div>
    </section>
  );
}

function DetailsForm({ building, onCancel, onSaved }) {
  const [name, setName] = useState(building.name);
  const [description, setDescription] = useState(building.description);
  const [photos, setPhotos] = useState(emptyPhotos(building.images));
  const [error, setError] = useState(null);
  const [nameError, setNameError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Enter the building's name.");
      return;
    }
    const body = new FormData();
    body.append("name", name.trim());
    body.append("description", description.trim());
    photos.added.forEach((p) => body.append("photos", p.file));

    setBusy(true);
    setError(null);
    setNameError(null);
    try {
      let { building: saved } = await api(API.building, { method: "PATCH", form: body });
      const after = await syncRemovedPhotos(photos.removed, API.buildingImage);
      if (after) saved = after.building;
      onSaved(saved);
    } catch (err) {
      setNameError(err.field("name"));
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field id="b-name" label="Name" error={nameError}>
        <input id="b-name" className={`input ${nameError ? "invalid" : ""}`} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="b-desc" label="Description" optional>
        <textarea id="b-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Address, landmarks, anything residents should know" />
      </Field>
      <Field id="b-photos" label="Photos" hint="Removed photos are deleted when you save.">
        <PhotoField id="b-photos" value={photos} onChange={setPhotos} />
      </Field>
      <p className="field-hint" style={{ marginTop: 16 }}>
        The number of floors ({building.total_floors}) was set when the building was created and can&apos;t be changed.
      </p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

/* ---------------------------------------------------------------- Floors & units */

function FloorsAndUnits() {
  const { data, error, setData } = useResource(API.floors);
  const [floorId, setFloorId] = useState(null);
  const [sheet, setSheet] = useState(null); // { kind: "unit", unit? } | { kind: "copy" }

  const floors = data?.floors;
  useEffect(() => {
    if (floors?.length && !floors.some((f) => f.id === floorId)) setFloorId(floors[0].id);
  }, [floors, floorId]);

  if (error) return <section className="section"><Alert>{error}</Alert></section>;

  const floor = floors?.find((f) => f.id === floorId);
  const totalUnits = floors?.reduce((n, f) => n + f.units.length, 0) ?? 0;

  const replaceFloorUnits = (fid, fn) =>
    setData((d) => ({ floors: d.floors.map((f) => (f.id === fid ? { ...f, units: fn(f.units) } : f)) }));

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>Floors and units</h2>
          {floors && <p>{plural(totalUnits, "unit")} across {plural(floors.length, "floor")}</p>}
        </div>
      </div>

      {!floors ? <Loading /> : (
        <>
          <div className="floor-select">
            <select className="select" value={floorId ?? ""} onChange={(e) => setFloorId(Number(e.target.value))} aria-label="Floor">
              {floors.map((f) => <option key={f.id} value={f.id}>Floor {f.number} ({plural(f.units.length, "unit")})</option>)}
            </select>
          </div>

          <div className="split floors">
            <div className="panel split-list floor-rail">
              <ul className="rows">
                {floors.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="row" aria-current={f.id === floorId} onClick={() => setFloorId(f.id)}>
                      <span className="row-main"><span className="row-title">Floor {f.number}</span></span>
                      <span className="row-end">{f.units.length ? plural(f.units.length, "unit") : <span className="faint">Empty</span>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {floor && (
              <div className="panel split-detail">
                <div className="panel-pad" style={{ paddingBottom: 12 }}>
                  <div className="detail-head">
                    <h2>Floor {floor.number}</h2>
                    <div className="page-actions">
                      {floor.units.length > 0 && floors.length > 1 && (
                        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSheet({ kind: "copy" })}>Copy layout</button>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet({ kind: "unit" })}>Add unit</button>
                    </div>
                  </div>
                </div>
                {floor.units.length === 0 ? (
                  <Empty title="No units on this floor">
                    Add them one by one, or set up one floor and copy its layout to the others.
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr><th>Unit</th><th className="right">Area</th><th className="right">Rent / month</th><th className="hide-sm">Occupancy</th><th /></tr>
                      </thead>
                      <tbody>
                        {floor.units.map((u) => (
                          <tr key={u.id} className="clickable" onClick={() => setSheet({ kind: "unit", unit: u })}>
                            <td className="cell-strong">{u.name}</td>
                            <td className="right num">{u.area} sq.ft</td>
                            <td className="right num">{u.rent ? money(u.rent) : <span className="faint">None</span>}</td>
                            <td className="hide-sm">{u.residents ? <span className="muted">{plural(u.residents, "resident")}</span> : <span className="faint">Vacant</span>}</td>
                            <td className="right"><span className="link small">Edit</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {sheet?.kind === "unit" && floor && (
        <UnitSheet
          floor={floor}
          unit={sheet.unit}
          onClose={() => setSheet(null)}
          onSaved={(saved) => {
            replaceFloorUnits(floor.id, (units) => {
              const others = units.filter((u) => u.id !== saved.id);
              return [...others, saved].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            });
            setSheet(null);
          }}
          onDeleted={(id) => {
            replaceFloorUnits(floor.id, (units) => units.filter((u) => u.id !== id));
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === "copy" && floor && (
        <CopySheet floor={floor} floors={floors} onClose={() => setSheet(null)}
          onDone={(next) => { setData({ floors: next }); setSheet(null); }} />
      )}
    </section>
  );
}

function UnitSheet({ floor, unit, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({ name: unit?.name ?? "", area: unit?.area ?? "", rent: unit?.rent ?? "" });
  const [photos, setPhotos] = useState(emptyPhotos(unit?.images));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  async function save(e) {
    e?.preventDefault();
    const errs = {};
    if (!String(form.name).trim()) errs.name = "Enter the unit's name, e.g. A or 101.";
    const area = Number(form.area);
    if (form.area === "" || !Number.isInteger(area) || area < 1) errs.area = "Whole square feet, 1 or more.";
    const rent = Number(form.rent);
    if (form.rent === "" || !Number.isInteger(rent) || rent < 0) errs.rent = "Whole rupees; 0 if there's no rent.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = new FormData();
    if (!unit) body.append("floor", floor.id);
    body.append("name", String(form.name).trim());
    body.append("area", String(area));
    body.append("rent", String(rent));
    photos.added.forEach((p) => body.append("photos", p.file));

    setBusy(true);
    setError(null);
    try {
      let saved = await api(unit ? API.unit(unit.id) : API.units, { method: unit ? "PATCH" : "POST", form: body });
      saved = (await syncRemovedPhotos(photos.removed, API.unitImage)) ?? saved;
      onSaved(saved);
    } catch (err) {
      setErrors({ name: err.field("name"), area: err.field("area"), rent: err.field("rent") });
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete unit ${unit.name}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(API.unit(unit.id), { method: "DELETE" });
      onDeleted(unit.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={unit ? `Unit ${unit.name}` : "New unit"}
      description={`Floor ${floor.number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : unit ? "Save changes" : "Add unit"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
          {unit && <button type="button" className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={remove} disabled={busy}>Delete</button>}
        </>
      }
    >
      <form onSubmit={save} noValidate>
        <Field id="u-name" label="Unit name" error={errors.name}>
          <input id="u-name" className={`input ${errors.name ? "invalid" : ""}`} value={form.name} onChange={set("name")}
            placeholder="A or 101" maxLength={20} autoFocus />
        </Field>
        <div className="field-row" style={{ marginTop: 16 }}>
          <Field id="u-area" label="Area (sq.ft)" error={errors.area}>
            <input id="u-area" type="number" min="1" inputMode="numeric" className={`input ${errors.area ? "invalid" : ""}`}
              value={form.area} onChange={set("area")} />
          </Field>
          <Field id="u-rent" label="Rent per month (Rs.)" error={errors.rent}>
            <input id="u-rent" type="number" min="0" inputMode="numeric" className={`input ${errors.rent ? "invalid" : ""}`}
              value={form.rent} onChange={set("rent")} />
          </Field>
        </div>
        <Field id="u-photos" label="Photos" optional hint="Residents of this unit see these on their home page.">
          <PhotoField id="u-photos" value={photos} onChange={setPhotos} />
        </Field>
        {unit?.residents > 0 && <p className="field-hint" style={{ marginTop: 16 }}>{plural(unit.residents, "resident")} {unit.residents === 1 ? "lives" : "live"} here.</p>}
        <button type="submit" hidden />
      </form>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
      {unit && <UnitBills unit={unit} />}
    </Sheet>
  );
}

function CopySheet({ floor, floors, onClose, onDone }) {
  const others = floors.filter((f) => f.id !== floor.id);
  const [selected, setSelected] = useState(others.filter((f) => !f.units.length).map((f) => f.id));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function copy() {
    if (!selected.length) {
      setError("Pick at least one floor.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api(API.copyFloor(floor.id), { method: "POST", json: { to_floors: selected } });
      onDone(data.floors);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Copy floor ${floor.number}'s layout`}
      description={`Units ${floor.units.map((u) => u.name).join(", ")} with the same area and rent. Existing units are left alone; photos aren't copied.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={copy} disabled={busy}>
            {busy ? "Copying…" : `Copy to ${plural(selected.length, "floor")}`}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 14, marginBottom: 14 }} className="small">
        <button type="button" className="link" onClick={() => setSelected(others.map((f) => f.id))}>All floors</button>
        <button type="button" className="link" onClick={() => setSelected(others.filter((f) => !f.units.length).map((f) => f.id))}>Empty floors</button>
        <button type="button" className="link" onClick={() => setSelected([])}>None</button>
      </div>
      <div className="panel">
        <ul className="rows">
          {others.map((f) => (
            <li key={f.id}>
              <label className="row check" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggle(f.id)} />
                <span className="row-main"><span className="row-title">Floor {f.number}</span></span>
                <span className="row-end">{f.units.length ? plural(f.units.length, "unit") : <span className="faint">Empty</span>}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

// Every bill this unit has had, newest first, and what is still owed on it
function UnitBills({ unit }) {
  const { data, error } = useResource(`${API.bills}?unit=${unit.id}`);
  const unpaid = data?.filter((b) => !b.is_draft && b.status === "unpaid") ?? [];
  const owed = unpaid.reduce((n, b) => n + Number(b.total), 0);

  return (
    <>
      <div className="detail-divider" />
      <div className="section-head" style={{ marginBottom: 8 }}>
        <h2>Billing history</h2>
        {data && data.length > 0 && (
          <span className="small" style={unpaid.some((b) => b.is_overdue) ? { color: "var(--red)" } : { color: "var(--ink-2)" }}>
            {unpaid.length ? `${money(owed)} unpaid` : "All paid"}
          </span>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {!error && !data && <Loading />}
      {data && data.length === 0 && <p className="small faint">No bills yet.</p>}
      {data && data.length > 0 && (
        <ul className="rows unit-bills">
          {data.map((b) => (
            <li key={b.id} className="row">
              <span className="row-main">
                <span className="row-title">{monthLabel(b.period)}</span>
                <span className="row-sub">{b.billed_to.length ? b.billed_to.map((p) => p.name).join(", ") : b.is_draft ? "Not sent yet" : "Nobody recorded"}</span>
              </span>
              <span className="row-end">
                <span className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>{money(b.total)}</span>
                <BillStatus bill={b} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
