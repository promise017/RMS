"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "../../../components/AppShell";
import NoticeAttachment from "../../../components/NoticeAttachment";
import { Alert, Empty, Field, Loading, PageHeader } from "../../../components/ui";
import { api, API } from "../../../lib/api";
import { formatDateTime, timeAgo } from "../../../lib/format";
import { useGate, useResource } from "../../../lib/hooks";
import { photoSrc } from "../../../lib/photos";
import { useSelection } from "../../../lib/useSelection";

const MAX_MB = 10; // same limit as the server

export default function NoticesPage() {
  const user = useGate("secretary");
  const { data, error, setData } = useResource(user ? API.notices : null);
  const [selected, select] = useSelection(data);
  const [mode, setMode] = useState("view"); // "view" | "edit" | "new"

  if (!user) return null;

  const open = (id) => { select(id); setMode("view"); };
  const detailOpen = mode === "new" || !!selected;

  return (
    <AppShell user={user}>
      <div className="page">
        <PageHeader
          title="Notices"
          description="Everything you post here is shown to residents and guards."
          actions={data && <button type="button" className="btn btn-primary" onClick={() => { select(null); setMode("new"); }}>New notice</button>}
        />
        {error && <Alert>{error}</Alert>}
        {!error && !data && <Loading />}

        {data && (
          <div className={`split ${detailOpen ? "has-selection" : ""}`}>
            <div className="split-list panel">
              {data.length === 0 ? (
                <Empty title="No notices yet">Water cuts, meetings, repairs: post them here so everyone knows.</Empty>
              ) : (
                <ul className="rows">
                  {data.map((n) => (
                    <li key={n.id}>
                      <button type="button" className="row" aria-current={mode !== "new" && selected?.id === n.id} onClick={() => open(n.id)}>
                        <span className="row-main">
                          <span className="row-title">{n.title}</span>
                          <span className="row-sub">{timeAgo(n.created_at)}{n.attachment_type ? ` · ${n.attachment_type === "pdf" ? "PDF" : "Image"} attached` : ""}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="split-detail">
              {mode === "new" ? (
                <NoticeEditor
                  onCancel={() => setMode("view")}
                  onSaved={(n) => { setData((list) => [n, ...list]); select(n.id); setMode("view"); }}
                />
              ) : selected && mode === "edit" ? (
                <NoticeEditor
                  key={selected.id}
                  notice={selected}
                  onCancel={() => setMode("view")}
                  onSaved={(n) => { setData((list) => list.map((x) => (x.id === n.id ? n : x))); setMode("view"); }}
                />
              ) : selected ? (
                <NoticeView
                  key={selected.id}
                  notice={selected}
                  onBack={() => select(null)}
                  onEdit={() => setMode("edit")}
                  onDeleted={() => { setData((list) => list.filter((x) => x.id !== selected.id)); select(null); }}
                />
              ) : data.length > 0 && (
                <div className="panel"><Empty>Select a notice to read or edit it.</Empty></div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function NoticeView({ notice: n, onBack, onEdit, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const edited = new Date(n.updated_at) - new Date(n.created_at) > 60_000;

  async function remove() {
    if (!window.confirm(`Delete “${n.title}”? Residents and guards won't see it any more.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(API.notice(n.id), { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <article className="panel panel-pad">
      <button type="button" className="btn btn-quiet btn-sm back-to-list" onClick={onBack}>← All notices</button>
      <div className="detail-head">
        <h2 style={{ fontSize: 18 }}>{n.title}</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit} disabled={busy}>Edit</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy}>Delete</button>
        </div>
      </div>
      <div className="detail-meta">
        {n.posted_by && <span>{n.posted_by}</span>}
        <span>{formatDateTime(n.created_at)}</span>
        {edited && <span>Edited {formatDateTime(n.updated_at)}</span>}
      </div>
      <div className="detail-body">
        <p className="prose">{n.message}</p>
        {n.attachment && <div style={{ marginTop: 18 }}><NoticeAttachment notice={n} /></div>}
      </div>
      {error && <div style={{ marginTop: 16 }}><Alert>{error}</Alert></div>}
    </article>
  );
}

function NoticeEditor({ notice, onCancel, onSaved }) {
  const [title, setTitle] = useState(notice?.title ?? "");
  const [message, setMessage] = useState(notice?.message ?? "");
  const [file, setFile] = useState(null); // { file, url, isPdf }
  const [removeFile, setRemoveFile] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  useEffect(() => () => file && URL.revokeObjectURL(file.url), [file]);

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf && !f.type.startsWith("image/")) {
      setErrors((x) => ({ ...x, attachment: "Attach an image or a PDF." }));
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setErrors((x) => ({ ...x, attachment: `That file is over ${MAX_MB} MB.` }));
      return;
    }
    setErrors((x) => ({ ...x, attachment: undefined }));
    setFile({ file: f, url: URL.createObjectURL(f), isPdf });
    setRemoveFile(false);
  }

  async function save(e) {
    e.preventDefault();
    const errs = {};
    if (!title.trim()) errs.title = "Give the notice a title.";
    if (!message.trim()) errs.message = "Write the notice.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = new FormData();
    body.append("title", title.trim());
    body.append("message", message.trim());
    if (file) body.append("attachment", file.file);
    else if (removeFile) body.append("remove_attachment", "true");

    setBusy(true);
    setError(null);
    try {
      onSaved(await api(notice ? API.notice(notice.id) : API.notices, { method: notice ? "PATCH" : "POST", form: body }));
    } catch (err) {
      const fieldErrs = { title: err.field("title"), message: err.field("message"), attachment: err.field("attachment") };
      setErrors(fieldErrs);
      if (!Object.values(fieldErrs).some(Boolean)) setError(err.message);
      setBusy(false);
    }
  }

  const saved = notice?.attachment && !removeFile && !file;

  return (
    <form className="panel panel-pad" onSubmit={save} noValidate>
      <button type="button" className="btn btn-quiet btn-sm back-to-list" onClick={onCancel}>← Back</button>
      <h2 style={{ fontSize: 18, marginBottom: 20 }}>{notice ? "Edit notice" : "New notice"}</h2>

      <Field id="n-title" label="Title" error={errors.title}>
        <input id="n-title" className={`input ${errors.title ? "invalid" : ""}`} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Water supply off on Sunday" maxLength={150} autoFocus />
      </Field>
      <Field id="n-message" label="Message" error={errors.message}>
        <textarea id="n-message" className={`textarea ${errors.message ? "invalid" : ""}`} rows={6} value={message}
          onChange={(e) => setMessage(e.target.value)} placeholder="What residents and guards need to know" />
      </Field>

      <Field id="n-file" label="Attachment" optional error={errors.attachment} hint={`An image or PDF, up to ${MAX_MB} MB.`}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {file && (
            file.isPdf
              ? <span className="file-link"><span className="kind">PDF</span><span className="name">{file.file.name}</span></span>
              : <img src={file.url} alt="" style={{ height: 56, borderRadius: 6, border: "1px solid var(--line)" }} />
          )}
          {saved && (
            notice.attachment_type === "pdf"
              ? <span className="file-link"><span className="kind">PDF</span><span className="name">{notice.attachment_name}</span></span>
              : <img src={photoSrc(notice.attachment)} alt="" style={{ height: 56, borderRadius: 6, border: "1px solid var(--line)" }} />
          )}
          {removeFile && !file && <span className="small faint">The attachment will be removed when you save.</span>}

          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
            {file || saved ? "Replace" : "Choose file"}
          </button>
          {file && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setFile(null)}>Remove</button>}
          {saved && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRemoveFile(true)}>Remove</button>}
          {removeFile && !file && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRemoveFile(false)}>Keep it</button>}
          <input ref={input} id="n-file" type="file" accept="image/*,application/pdf,.pdf" onChange={pick} hidden />
        </div>
      </Field>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : notice ? "Save changes" : "Post notice"}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {error && <div style={{ marginTop: 12 }}><Alert>{error}</Alert></div>}
    </form>
  );
}
