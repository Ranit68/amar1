import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { permissionsFor, type Permission } from "@/lib/permissions";
import type { Business, BusinessMember } from "@/lib/database.types";

export const ACTIVE_BUSINESS_COOKIE = "active_business_id";

export interface Membership {
  member: BusinessMember;
  business: Business;
  permissions: Permission[];
}

export interface SessionContext {
  user: User;
  memberships: Membership[];
  /** Active membership, or null when the user belongs to no business yet. */
  active: Membership | null;
}

/** Session guaranteed to have an active business. Returned by requireSession. */
export interface ActiveSessionContext extends Omit<SessionContext, "active"> {
  active: Membership;
}

/**
 * Loads the signed-in user and their memberships. Redirects to /login when
 * unauthenticated. Returns a session whose `active` is null when the user is
 * authenticated but not yet a member of any business (the onboarding case).
 */
export async function getSession(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("business_members")
    .select("*, business:businesses(*)")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to load memberships: ${error.message}`);
  }

  const memberships: Membership[] = (data ?? [])
    .filter((row) => row.business)
    .map((row) => ({
      member: row as unknown as BusinessMember,
      business: (row as unknown as { business: Business }).business,
      permissions: permissionsFor(row.role, row.member_permissions ?? []),
    }));

  if (memberships.length === 0) {
    return { user, memberships: [], active: null };
  }

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  const active =
    memberships.find((m) => m.business.id === preferred) ?? memberships[0]!;

  return { user, memberships, active };
}

/**
 * Like getSession but guarantees a business context. Redirects to /login when
 * unauthenticated and to /onboarding when the user has no business yet.
 */
export async function requireSession(): Promise<ActiveSessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.active) redirect("/onboarding");
  return {
    user: session.user,
    memberships: session.memberships,
    active: session.active,
  };
}

export function hasPermission(
  session: SessionContext,
  permission: Permission,
): boolean {
  return session.active?.permissions.includes(permission) ?? false;
}

export function assertPermission(
  session: SessionContext,
  permission: Permission,
): void {
  if (!hasPermission(session, permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}
