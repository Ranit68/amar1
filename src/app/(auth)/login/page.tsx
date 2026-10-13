import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      {params.error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          লগইন ব্যর্থ হয়েছে, আবার চেষ্টা করুন।
        </p>
      ) : null}
      <LoginForm next={params.next} />
    </>
  );
}
