import { requireSession } from "@/lib/auth";
import { listMembers } from "@/lib/data/reports";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BusinessForm, InviteForm } from "@/components/forms/settings-forms";
import { updateBusinessAction, inviteMemberAction } from "./actions";

const ROLE_LABEL: Record<string, string> = {
  owner: "মালিক",
  manager: "ম্যানেজার",
  staff: "কর্মী",
};

export default async function SettingsPage() {
  const session = await requireSession();
  const business = session.active.business;
  const members = await listMembers(business.id);
  const canManage = session.active.permissions.includes("settings.manage");
  const canInvite = session.active.permissions.includes("users.manage");

  return (
    <>
      <PageHeader title="সেটিংস" subtitle="ব্যবসার তথ্য ও সদস্য" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ব্যবসার তথ্য</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {canManage ? (
              <BusinessForm
                name={business.name}
                locale={business.locale}
                action={updateBusinessAction}
              />
            ) : (
              <>
                <Row label="নাম" value={business.name} />
                <Row label="মুদ্রা" value={business.currency} />
                <Row label="টাইমজোন" value={business.timezone} />
                <Row label="ভাষা" value={business.locale === "bn" ? "বাংলা" : "English"} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>সদস্য</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-ink-100">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink-900">
                      {ROLE_LABEL[m.role] ?? m.role}
                    </p>
                    <p className="text-xs text-ink-400">
                      {m.userId.slice(0, 8)}… · {m.status}
                    </p>
                  </div>
                  <Badge tone={m.role === "owner" ? "brand" : "neutral"}>
                    {ROLE_LABEL[m.role] ?? m.role}
                  </Badge>
                </div>
              ))}
            </div>
            {canInvite ? (
              <div className="border-t border-ink-100 p-4">
                <InviteForm action={inviteMemberAction} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {business.currency ? (
        <p className="mt-6 text-sm text-ink-400">
          মুদ্রা {business.currency} · টাইমজোন {business.timezone}
        </p>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-ink-900">{value}</span>
    </div>
  );
}
