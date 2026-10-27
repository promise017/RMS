"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession } from "../lib/session";
import { api, API } from "../lib/api";
import { MenuIcon, CloseIcon } from "./Icons";

const NAV = {
  secretary: [
    { href: "/secretary", label: "Overview", exact: true },
    { href: "/secretary/building", label: "Building" },
    { href: "/secretary/people", label: "People" },
    { href: "/secretary/bills", label: "Bills" },
    { href: "/secretary/payments", label: "Payments", badge: "payments" },
    { href: "/secretary/complaints", label: "Complaints", badge: "complaints" },
    { href: "/secretary/notices", label: "Notices" },
    { href: "/secretary/visitors", label: "Visitors" },
  ],
  resident: [
    { href: "/resident", label: "My home", exact: true },
    { href: "/resident/bills", label: "Bills", badge: "bills" },
    { href: "/resident/complaints", label: "Complaints", badge: "complaints" },
    { href: "/resident/notices", label: "Notices", badge: "notices" },
  ],
  guard: [
    { href: "/guard", label: "Visitors", exact: true },
    { href: "/guard/notices", label: "Notices", badge: "notices" },
  ],
};

const ROLE = { secretary: "Secretary", resident: "Resident", guard: "Guard" };

// Sidebar navigation for the signed-in areas; collapses to a top bar on phones.
export default function AppShell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Names can change while signed in (building renamed, profile edited), so follow the stored copy
  const [me, setMe] = useState(user);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const sync = () => setMe(getSession()?.user ?? user);
    window.addEventListener("griha:user", sync);
    return () => window.removeEventListener("griha:user", sync);
  }, [user]);

  const buildingName = me.building?.name;

  function signOut() {
    clearSession();
    router.replace("/login");
  }

  const items = NAV[user.role] ?? [];
  const isActive = (item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));
  const unread = useUnread(items.find(isActive)?.badge);
  const anyUnread = Object.values(unread).some((n) => n > 0);

  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <header className="topbar">
        <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(true)}
          aria-label={anyUnread ? "Open navigation (you have unread items)" : "Open navigation"}>
          <MenuIcon />
          {anyUnread && <span className="menu-dot" aria-hidden="true" />}
        </button>
        <span className="wordmark">griha<span>.</span></span>
      </header>

      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link href={items[0]?.href ?? "/"} className="wordmark">griha<span>.</span></Link>
            {open && (
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close navigation">
                <CloseIcon />
              </button>
            )}
          </div>
          {buildingName && <span className="brand-sub">{buildingName}</span>}
        </div>

        <nav className="nav">
          {items.map((item) => (
            <Link key={item.href} href={item.href} aria-current={isActive(item) ? "page" : undefined}>
              {item.label}
              {unread[item.badge] > 0 && (
                <span className="nav-badge" aria-label={`${unread[item.badge]} new`}>
                  {unread[item.badge] > 9 ? "9+" : unread[item.badge]}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="who">{me.full_name || me.username}</span>
          <span className="role">{ROLE[user.role]}</span>
          <div className="foot-links">
            <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined}>Account</Link>
            <button type="button" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>

      {open && <div className="sheet-backdrop" style={{ zIndex: 25 }} onClick={() => setOpen(false)} aria-hidden="true" />}

      <main className="main">{children}</main>
    </div>
  );
}

/**
 * Unread counts for the sidebar badges, e.g. { notices: 2 }.
 * Opening a section (openSection) marks it read on the server; counts refresh every minute.
 */
function useUnread(openSection) {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = openSection
          ? await api(API.markSeen(openSection), { method: "POST" })
          : await api(API.badges);
        if (alive) setCounts(next);
      } catch { /* badges are a nicety; never break the page over them */ }
    };
    load();
    const timer = setInterval(async () => {
      try {
        const next = await api(API.badges);
        // While a section is open, whatever arrives in it is being seen
        if (alive) setCounts(openSection ? { ...next, [openSection]: 0 } : next);
      } catch { /* ignore */ }
    }, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [openSection]);

  return counts;
}
