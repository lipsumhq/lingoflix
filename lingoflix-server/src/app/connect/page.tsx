import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { chromeStoreUrl } from "@/lib/site";
import { ConnectClient } from "./ConnectClient";

export const metadata: Metadata = { title: "Connect LingoFlix" };

/**
 * Spec §7.3: hands the signed-in web session's token to the extension. The extension and the website share
 * this one session, so signing out on either side signs out both. EXTENSION_ID is read while rendering,
 * never at module load.
 */
export default async function ConnectPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in?next=%2Fconnect");

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-3xl font-black tracking-tight">Connect LingoFlix</h1>
      <p className="mt-2">{`Signed in as ${session.user.email}.`}</p>
      <ConnectClient
        extensionId={process.env.EXTENSION_ID || null}
        token={session.token}
        storeUrl={chromeStoreUrl()}
      />
    </div>
  );
}
