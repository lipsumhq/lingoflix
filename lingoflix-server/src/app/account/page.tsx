import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { AccountSummary } from "./AccountSummary";
import { SignOutButton } from "./SignOutButton";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in?next=%2Faccount");

  return (
    <section aria-labelledby="account-heading" className="mx-auto flex w-full max-w-md flex-col gap-6">
      <h1 id="account-heading" className="text-3xl font-black">
        Your account
      </h1>
      <AccountSummary email={session.user.email} />
      <SignOutButton />
    </section>
  );
}
