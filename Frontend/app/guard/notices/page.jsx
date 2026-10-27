"use client";

import AppShell from "../../../components/AppShell";
import NoticeFeed from "../../../components/NoticeFeed";
import { PageHeader } from "../../../components/ui";
import { useGate } from "../../../lib/hooks";

export default function GuardNotices() {
  const user = useGate("guard");
  if (!user) return null;
  return (
    <AppShell user={user}>
      <div className="page page-narrow">
        <PageHeader eyebrow={user.building?.name} title="Notices" description="Announcements from the secretary." />
        <NoticeFeed />
      </div>
    </AppShell>
  );
}
