"use client";

import { useState } from "react";
import { photoSrc } from "../lib/photos";
import { Lightbox } from "./Photos";

// A notice's file: images preview inline (click for full size), PDFs open in a new tab
export default function NoticeAttachment({ notice }) {
  const [viewing, setViewing] = useState(false);
  if (!notice.attachment) return null;
  const src = photoSrc(notice.attachment);

  if (notice.attachment_type === "pdf") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="file-link">
        <span className="kind">PDF</span>
        <span className="name">{notice.attachment_name}</span>
        <span className="faint">Open</span>
      </a>
    );
  }
  return (
    <>
      <button type="button" className="attachment-img" style={{ padding: 0, background: "none" }} onClick={() => setViewing(true)}
        aria-label="View image full size">
        <img src={src} alt={`Image attached to ${notice.title}`} />
      </button>
      {viewing && <Lightbox images={[{ id: notice.id, src }]} index={0} onIndex={() => {}} onClose={() => setViewing(false)} />}
    </>
  );
}
