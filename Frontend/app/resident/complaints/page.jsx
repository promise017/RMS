"use client";

import { useState } from "react";
import AppShell from "../../../components/AppShell";
import { Lightbox, PhotoField, emptyPhotos } from "../../../components/Photos";
import { Alert, Empty, Field, Loading, PageHeader, Sheet, Status } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { formatDateTime, timeAgo, unitLabel } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";
import { photoSrc } from "../../../lib/photos";


export default function ResidentComplaints() {
  const user = useGate("resident");
  const { data, error, setData } = useResource(user ? API.myComplaints : null);
  const [openId, setOpenId] = useState(null);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState(null);

  if (!user) return null;

  const waiting = data?.filter((c) => c.status !== "resolved").length ?? 0;

  return (
    <AppShell user={user}>
      <div className="page page-narrow">
        <PageHeader
          title="Complaints"
          description={data?.length
            ? `${waiting ? `${waiting} being looked at` : "All resolved"}. Your secretary's replies show here.`
            : "Report a problem to your secretary. Their replies show here."}
          actions={<button type="button" className="btn btn-primary" onClick={() => { setWriting(true); setNote(null); }}>New complaint</button>}
        />

        {note && <div style={{ marginBottom: 16 }}><Alert kind={note.kind}>{note.text}</Alert></div>}
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}

        {data && (
          <div className="panel">
            {data.length === 0 ? (
              <Empty
                title="No complaints"
                action={<div><button type="button" className="btn btn-secondary" onClick={() => setWriting(true)}>Report a problem</button></div>}
              >
                Something broken or bothering you? Let your secretary know.
              </Empty>
            ) : (
              <ul className="rows">
                {data.map((c) => (
                  <ComplaintRow
                    key={c.id}
                    complaint={c}
                    open={openId === c.id}
                    onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                    onWithdrawn={() => {
                      setData((list) => list.filter((x) => x.id !== c.id));
                      setNote({ kind: "ok", text: `“${c.title}” was withdrawn.` });
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {writing && (
          <NewComplaintSheet
            onClose={() => setWriting(false)}
            onSent={(c) => {
              setData((list) => [c, ...(list ?? [])]);
              setWriting(false);
              setOpenId(c.id);
              setNote({ kind: "ok", text: "Sent. Your secretary will see it and reply here." });
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function ComplaintRow({ complaint: c, open, onToggle, onWithdrawn }) {
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const canWithdraw = c.status === "open" && !c.response;

  async function withdraw() {
    if (!window.confirm(`Withdraw “${c.title}”? Your secretary won't see it any more.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(API.myComplaint(c.id), { method: "DELETE" });
      onWithdrawn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <li>
      <button type="button" className="row" aria-expanded={open} onClick={onToggle}>
        <span className="row-main">
          <span className="row-title">{c.title}</span>
          <span className="row-sub">{[c.unit && `Unit ${unitLabel(c.unit)}`, timeAgo(c.created_at), c.response && !open && "Replied"].filter(Boolean).join(" · ")}</span>
        </span>
        <Status value={c.status} />
      </button>

      {open && (
        <div style={{ padding: "6px 16px 18px" }}>
          <div className="detail-meta" style={{ marginTop: 0 }}>
            <span>Sent {formatDateTime(c.created_at)}</span>
            {c.is_anonymous && <span>Sent anonymously: your secretary doesn&apos;t see your name or unit</span>}
          </div>

          {c.description && <p className="prose" style={{ marginTop: 12 }}>{c.description}</p>}

          {c.photo && (
            <button type="button" className="attachment-img" style={{ marginTop: 12, padding: 0, background: "none" }}
              onClick={() => setViewing(true)} aria-label="View photo full size">
              <img src={photoSrc(c.photo)} alt={`Photo for ${c.title}`} style={{ maxHeight: 200 }} />
            </button>
          )}

          {c.response ? (
            <div className="reply-box">
              <span className="label">Reply from your secretary</span>
              <p className="prose">{c.response}</p>
            </div>
          ) : (
            <p className="reply-waiting">No reply yet.</p>
          )}
          {c.resolved_at && <p className="small faint" style={{ marginTop: 10 }}>Resolved {formatDateTime(c.resolved_at)}</p>}

          {canWithdraw && (
            <div className="form-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-danger btn-sm" onClick={withdraw} disabled={busy}>
                {busy ? "Withdrawing…" : "Withdraw complaint"}
              </button>
            </div>
          )}
          {error && <div style={{ marginTop: 10 }}><Alert>{error}</Alert></div>}
          {viewing && <Lightbox images={[{ id: c.id, src: photoSrc(c.photo) }]} index={0} onIndex={() => {}} onClose={() => setViewing(false)} />}
        </div>
      )}
    </li>
  );
}

function NewComplaintSheet({ onClose, onSent }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [photo, setPhoto] = useState(emptyPhotos());
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e?.preventDefault();
    if (!title.trim()) {
      setErrors({ title: "Say briefly what the problem is." });
      return;
    }
    const body = new FormData();
    body.append("title", title.trim());
    body.append("description", description.trim());
    body.append("is_anonymous", anonymous ? "true" : "false");
    if (photo.added[0]) body.append("photo", photo.added[0].file);

    setBusy(true);
    setErrors({});
    setError(null);
    try {
      onSent(await api(API.myComplaints, { method: "POST", form: body }));
    } catch (err) {
      const fieldErrs = { title: err.field("title"), photo: err.field("photo") };
      setErrors(fieldErrs);
      if (!Object.values(fieldErrs).some(Boolean)) setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="New complaint"
      description="Your secretary sees it straight away."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send complaint"}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }
    >
      <form onSubmit={send} noValidate>
        <Field id="c-title" label="What's wrong?" error={errors.title}>
          <input id="c-title" className={`input ${errors.title ? "invalid" : ""}`} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Bathroom tap leaking" maxLength={100} autoFocus />
        </Field>
        <Field id="c-desc" label="Details" optional>
          <textarea id="c-desc" className="textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Since when, how bad, anything that helps the secretary sort it out" />
        </Field>
        <Field id="c-photo" label="Photo" optional error={errors.photo}>
          <PhotoField id="c-photo" value={photo} onChange={setPhoto} multiple={false} />
        </Field>

        <div className="field" style={{ marginTop: 18 }}>
          <label className="check">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Send anonymously
          </label>
          <span className="field-hint">
            {anonymous
              ? "Your secretary won't see your name or unit. You'll still see this complaint and any reply here."
              : "Your secretary will see your name and phone number so they can follow up."}
          </span>
        </div>
        <button type="submit" hidden />
      </form>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </Sheet>
  );
}
