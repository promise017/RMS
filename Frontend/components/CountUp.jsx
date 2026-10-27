"use client";

import { useEffect, useState } from "react";

// A number that counts up from 0 when it first appears. Skipped for people who
// have asked their device for reduced motion.
export default function CountUp({ value, format = (n) => String(Math.round(n)), duration = 900 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);   // fast at first, settling at the end
      setShown(target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return <span className="num">{format(shown)}</span>;
}

// A bar that grows to its width after it appears (same reduced-motion rule, via CSS)
export function GrowBar({ percent }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setWidth(percent));
    return () => cancelAnimationFrame(t);
  }, [percent]);
  return <span className="grow-bar" style={{ width: `${width}%` }} />;
}
