"use client";

import { useEffect, useRef, useState } from "react";
import { photoSrc } from "../lib/photos";
import { ChevronLeft, ChevronRight, CloseIcon, PlusIcon, UndoIcon } from "./Icons";

// Full-screen viewer. images: [{ id, src }]
export function Lightbox({ images, index, onIndex, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % images.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onIndex, onClose]);

  const many = images.length > 1;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={onClose}>
      <img src={images[index].src} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
      {many && (
        <>
          <button type="button" className="icon-btn prev" aria-label="Previous photo"
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }}>
            <ChevronLeft />
          </button>
          <button type="button" className="icon-btn next" aria-label="Next photo"
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }}>
            <ChevronRight />
          </button>
          <span className="counter">{index + 1} of {images.length}</span>
        </>
      )}
    </div>
  );
}

// Mosaic of up to five photos (first one large) that opens the viewer.
// photos: [{ id, photo }] as the API returns them.
export function Gallery({ photos }) {
  const [index, setIndex] = useState(null);
  if (!photos?.length) return null;

  const images = photos.map((p) => ({ id: p.id, src: photoSrc(p.photo) }));
  // Layouts that fill the grid exactly: 1, 2, 3 (one large + two stacked) or 5 (one large + 2×2)
  const shown = images.slice(0, images.length >= 5 ? 5 : Math.min(images.length, 3));
  const extra = images.length - shown.length;

  return (
    <>
      <div className={`gallery count-${shown.length}`}>
        {shown.map((img, i) => (
          <button
            key={img.id}
            type="button"
            className={extra && i === shown.length - 1 ? "gallery-more" : ""}
            onClick={() => setIndex(i)}
            aria-label={`Open photo ${i + 1} of ${images.length}`}
          >
            <img src={img.src} alt="" loading="lazy" />
            {extra > 0 && i === shown.length - 1 && <span>+{extra} more</span>}
          </button>
        ))}
      </div>
      {index !== null && <Lightbox images={images} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />}
    </>
  );
}

/**
 * Edit a set of photos: saved ones can be marked for removal, new files added.
 * value: { existing: [{id, photo}], removed: [ids], added: [{ file, url }] }
 */
export function PhotoField({ id, value, onChange, multiple = true }) {
  const input = useRef(null);
  const { existing = [], removed = [], added = [] } = value;

  // Free preview URLs of files that are no longer listed
  const urls = useRef(new Set());
  useEffect(() => {
    const current = new Set(added.map((a) => a.url));
    urls.current.forEach((u) => { if (!current.has(u)) URL.revokeObjectURL(u); });
    urls.current = current;
  }, [added]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function pick(e) {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    if (!files.length) return;
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    onChange({ ...value, added: multiple ? [...added, ...next] : next.slice(0, 1) });
  }

  const toggleRemoved = (photoId) =>
    onChange({ ...value, removed: removed.includes(photoId) ? removed.filter((x) => x !== photoId) : [...removed, photoId] });

  return (
    <div className="thumbs">
      {existing.map((p) => {
        const gone = removed.includes(p.id);
        return (
          <div key={p.id} className={`thumb ${gone ? "is-removed" : ""}`}>
            <img src={photoSrc(p.photo)} alt="" />
            <button type="button" className="thumb-action" onClick={() => toggleRemoved(p.id)}
              aria-label={gone ? "Keep this photo" : "Remove this photo"} title={gone ? "Keep" : "Remove"}>
              {gone ? <UndoIcon /> : <CloseIcon />}
            </button>
          </div>
        );
      })}
      {added.map((a) => (
        <div key={a.url} className="thumb is-new">
          <img src={a.url} alt="" />
          <button type="button" className="thumb-action" aria-label="Remove this photo" title="Remove"
            onClick={() => onChange({ ...value, added: added.filter((x) => x !== a) })}>
            <CloseIcon />
          </button>
        </div>
      ))}
      <button type="button" className="thumb-add" onClick={() => input.current?.click()}>
        <PlusIcon />
        Add photo
      </button>
      <input ref={input} id={id} type="file" accept="image/*" multiple={multiple} onChange={pick} hidden />
    </div>
  );
}

export const emptyPhotos = (existing = []) => ({ existing, removed: [], added: [] });
