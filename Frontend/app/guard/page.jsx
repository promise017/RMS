"use client";

import AppShell from "../../components/AppShell";
import VisitorLog from "../../components/VisitorLog";
import { useGate } from "../../lib/hooks";

// The guard's main page: who is inside, checking people in and out
export default function GuardVisitors() {
  const user = useGate("guard");
  if (!user) return null;
  return (
    <AppShell user={user}>
      <div className="page">
        <VisitorLog canLog buildingName={user.building?.name} />
      </div>
    </AppShell>
  );
}
