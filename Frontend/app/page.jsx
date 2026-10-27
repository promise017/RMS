"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession, homePathFor } from "../lib/session";

// "/" just sends people where they belong
export default function Index() {
  const router = useRouter();
  useEffect(() => {
    const s = getSession();
    router.replace(s ? homePathFor(s.user) : "/login");
  }, [router]);
  return null;
}
