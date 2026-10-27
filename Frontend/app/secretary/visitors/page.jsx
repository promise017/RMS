"use client";

import AppShell from "../../../components/AppShell";
import VisitorLog from "../../../components/VisitorLog";
import { useGate } from "../../../lib/hooks";

// Read-only: the guards keep the log
export default function SecretaryVisitors() {
  const user = useGate("secretary");
  if (!user) return null;
  return (
    <AppShell user={user}>
      <div className="page">
        <VisitorLog canLog={false} />
      </div>
    </AppShell>
  );
}
