import { requireSession } from "@/lib/auth";
import { AppShell } from "@/components/app/shell";
import type { ReactNode } from "react";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();

  return (
    <AppShell
      userEmail={session.user.email ?? session.user.id}
      memberships={session.memberships.map((m) => ({
        businessId: m.business.id,
        name: m.business.name,
        role: m.member.role,
      }))}
      activeBusinessId={session.active.business.id}
      activeBusinessName={session.active.business.name}
      activeRole={session.active.member.role}
      permissions={session.active.permissions}
    >
      {children}
    </AppShell>
  );
}
