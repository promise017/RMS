"use client";

import { useState } from "react";
import { Alert } from "./ui";
import { api, API } from "../lib/api";

// The building's join code with Copy / Turn off / New code (People page)
export default function JoinCode({ building, onBuilding }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function run(fn, done) {
    setBusy(true);
    setNote(null);
    try {
      const data = await fn();
      onBuilding(data.building);
      setNote({ kind: "ok", text: done });
    } catch (err) {
      setNote({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(building.join_code);
      setNote({ kind: "ok", text: "Code copied." });
    } catch {
      setNote({ kind: "error", text: "Couldn't copy. Select the code and copy it by hand." });
    }
  }

  const toggle = () => run(
    () => api(API.building, { method: "PATCH", json: { code_active: !building.code_active } }),
    building.code_active ? "Code turned off. Nobody new can join until you turn it back on." : "Code turned on.",
  );

  const regenerate = () => {
    if (!window.confirm("Make a new code? The current one stops working. People who already joined stay joined.")) return;
    run(() => api(API.regenerateCode, { method: "POST" }), "New code created.");
  };

  return (
    <div>
      <div className="panel code-strip">
        <div>
          <div className="label">Join code {building.code_active ? "" : "· turned off"}</div>
          <div className={`code ${building.code_active ? "" : "off"}`}>{building.join_code}</div>
        </div>
        <p className="small muted" style={{ maxWidth: 300 }}>
          Residents and guards enter this after signing up to join {building.name}.
        </p>
        <div className="actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy} disabled={busy}>Copy</button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={toggle} disabled={busy}>
            {building.code_active ? "Turn off" : "Turn on"}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={regenerate} disabled={busy}>New code</button>
        </div>
      </div>
      {note && <div style={{ marginTop: 8 }}><Alert kind={note.kind}>{note.text}</Alert></div>}
    </div>
  );
}
