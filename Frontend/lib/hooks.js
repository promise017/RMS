"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, homePathFor } from "./session";
import { api } from "./api";

/**
 * Lets a page through only for the right kind of user.
 * area: "secretary" | "resident" | "guard" | "member" (any user who belongs somewhere).
 * Returns the stored user once allowed, or null while redirecting.
 */
export function useGate(area) {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    const home = homePathFor(s.user);
    const allowed = area === "member" ? home !== "/join" : home === `/${area}`;
    if (allowed) setUser(s.user);
    else router.replace(home);
  }, [router, area]);

  return user;
}

/**
 * Loads one API resource. `url` null means "don't load yet".
 * Returns { data, error, loading, reload, setData }.
 */
export function useResource(url) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!url) return;
    setError(null);
    try {
      setData(await api(url));
    } catch (err) {
      setError(err.message);
    }
  }, [url]);

  useEffect(() => {
    setData(undefined);
    reload();
  }, [reload]);

  return { data, error, loading: data === undefined && !error, reload, setData };
}
