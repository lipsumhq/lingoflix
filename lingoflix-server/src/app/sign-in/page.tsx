import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentSession } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  if (await getCurrentSession()) redirect(next);

  return (
    <section aria-labelledby="sign-in-heading" className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div>
        <h1 id="sign-in-heading" className="text-3xl font-black">
          Sign in to LingoFlix
        </h1>
        <p className="mt-2 text-mute">Use Google, or get a one-time link by email. No password needed.</p>
      </div>
      <SignInForm next={next} initialError={first(params.error) ?? null} />
    </section>
  );
}
