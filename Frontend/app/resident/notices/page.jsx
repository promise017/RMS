"use client";

import AppShell from "../../../components/AppShell";
import NoticeFeed from "../../../components/NoticeFeed";
import { PageHeader } from "../../../components/ui";
import { useGate } from "../../../lib/hooks";

export default function ResidentNotices() {
  const user = useGate("resident");
  if (!user) return null;
  return (
    <AppShell user={user}>
      <div className="page page-narrow">
        <PageHeader title="Notices" description="Announcements from your building's secretary." />
        <NoticeFeed />
      </div>
    </AppShell>
  );
}
