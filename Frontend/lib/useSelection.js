"use client";

import { useEffect, useState } from "react";

// Which item of a master-detail list is open. On wide screens the first item opens
// by default (so the detail pane isn't empty); on phones nothing opens until tapped.
// An ?id= in the address opens that item.
export function useSelection(items) {
  const [selectedId, setSelectedId] = useState(null);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (initialised || !items) return;
    const fromUrl = Number(new URLSearchParams(window.location.search).get("id"));
    if (fromUrl && items.some((i) => i.id === fromUrl)) setSelectedId(fromUrl);
    else if (items.length && window.matchMedia("(min-width: 961px)").matches) setSelectedId(items[0].id);
    setInitialised(true);
  }, [items, initialised]);

  const selected = items?.find((i) => i.id === selectedId) ?? null;
  return [selected, setSelectedId];
}
