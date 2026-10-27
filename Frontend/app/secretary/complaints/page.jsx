"use client";

import { useEffect, useState } from "react";
import AppShell from "../../../components/AppShell";
import { Lightbox } from "../../../components/Photos";
import { Alert, Empty, Field, Loading, PageHeader, Segmented, Status } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { formatDateTime, timeAgo, unitLabel } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";
import { photoSrc } from "../../../lib/photos";
import { useSelection } from "../../../lib/useSelection";

const FILTERS = [
  { value: "active", label: "Needs attention", match: (c) => c.status !== "resolved" },
  { value: "resolved", label: "Resolved", match: (c) => c.status === "resolved" },
  { value: "all", label: "All", match: () => true },
];

const sender = (c) => (c.is_anonymous ? "Anonymous" : c.raised_by?.name ?? "Unknown");
const place = (c) => (c.unit ? unitLabel(c.unit) : null);

export default function ComplaintsPage() {
  const user = useGate("secretary");
  const { data, error, setData } = useResource(user ? API.complaints : null);
  const [filter, setFilter] = useState("active");

  const match = FILTERS.find((f) => f.value === filter).match;
  const shown = data?.filter(match);
  const [selected, select] = useSelection(shown);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <div className="page">
        <PageHeader title="Complaints" description="Problems residents have reported. Replying resolves a complaint and shows your reply to the resident." />
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}

        {data && (
          <div className={`split ${selected ? "has-selection" : ""}`}>
            <div className="split-list">
              <div style={{ marginBottom: 12 }}>
                <Segmented
                  label="Filter"
                  value={filter}
                  onChange={(v) => { setFilter(v); select(null); }}
                  options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: data.filter(f.match).length }))}
                />
              </div>
              <div className="panel">
                {shown.length === 0 ? (
                  <Empty title={filter === "active" ? "Nothing needs attention" : "No complaints here"}>
                    {filter === "active" ? "New complaints from residents will appear here." : null}
                  </Empty>
                ) : (
                  <ul className="rows">
                    {shown.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="row" aria-current={selected?.id === c.id} onClick={() => select(c.id)}>
                          <span className="row-main">
                            <span className="row-title">{c.title}</span>
                            <span className="row-sub">{[sender(c), place(c), timeAgo(c.created_at)].filter(Boolean).join(" · ")}</span>
                          </span>
                          <Status value={c.status} dotOnly />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="split-detail">
              {selected ? (
                <ComplaintDetail
                  key={selected.id}
                  complaint={selected}
                  onBack={() => select(null)}
                  onSaved={(saved) => setData((list) => list.map((c) => (c.id === saved.id ? saved : c)))}
                />
              ) : (
                shown.length > 0 && <div className="panel"><Empty>Select a complaint to read it and reply.</Empty></div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ComplaintDetail({ complaint: c, onBack, onSaved }) {
  const resolved = c.status === "resolved";
  const [editing, setEditing] = useState(!resolved);   // open complaints start with the reply box
  const [response, setResponse] = useState(c.response);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    setResponse(c.response);
    setEditing(c.status !== "resolved");
  }, [c]);

  async function save(e) {
    e.preventDefault();
    if (!response.trim()) {
      setNote({ kind: "error", text: "Write a reply for the resident." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      onSaved(await api(API.complaint(c.id), { method: "PATCH", json: { response: response.trim() } }));
      setNote({ kind: "ok", text: resolved ? "Reply updated. The resident can see it." : "Replied and resolved. The resident can see your reply." });
    } catch (err) {
      setNote({ kind: "error", text: err.field("response") || err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad">
      <button type="button" className="btn btn-quiet btn-sm back-to-list" onClick={onBack}>← All complaints</button>
      <div className="detail-head">
        <h2 style={{ fontSize: 18 }}>{c.title}</h2>
        <Status value={c.status} />
      </div>
      <div className="detail-meta">
        <span>{sender(c)}</span>
        {place(c) && <span>{place(c)}</span>}
        {c.raised_by?.phone && <a href={`tel:${c.raised_by.phone}`}>{c.raised_by.phone}</a>}
        <span>{formatDateTime(c.created_at)}</span>
      </div>

      <div className="detail-body">
        {c.description ? <p className="prose">{c.description}</p> : <p className="faint">No description given.</p>}
        {c.photo && (
          <button type="button" className="attachment-img" style={{ marginTop: 16, padding: 0, border: "1px solid var(--line)", background: "none" }}
            onClick={() => setViewing(true)} aria-label="View photo full size">
            <img src={photoSrc(c.photo)} alt={`Photo for ${c.title}`} />
          </button>
        )}
      </div>

      <div className="detail-divider" />

      {editing ? (
        <form onSubmit={save} noValidate>
          <Field id="reply" label="Reply to the resident" hint={resolved ? undefined : "Sending a reply marks the complaint as resolved."}>
            <textarea id="reply" className="textarea" value={response} onChange={(e) => setResponse(e.target.value)}
              placeholder="e.g. The plumber fixed the tap this morning." autoFocus={!resolved} />
          </Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : resolved ? "Save reply" : "Reply and resolve"}
            </button>
            {resolved && (
              <button type="button" className="btn btn-quiet" onClick={() => { setEditing(false); setResponse(c.response); setNote(null); }}>Cancel</button>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="reply-box" style={{ marginTop: 0 }}>
            <span className="label">Your reply</span>
            <p className="prose">{c.response}</p>
          </div>
          <p className="field-hint" style={{ marginTop: 8 }}>Resolved {formatDateTime(c.resolved_at)}</p>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setNote(null); }}>Edit reply</button>
          </div>
        </>
      )}
      {note && <div style={{ marginTop: 12 }}><Alert kind={note.kind}>{note.text}</Alert></div>}

      {viewing && <Lightbox images={[{ id: c.id, src: photoSrc(c.photo) }]} index={0} onIndex={() => {}} onClose={() => setViewing(false)} />}
    </div>
  );
}
