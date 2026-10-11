import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { upgradeDestination } from "@/lib/upgrade";

export const dynamic = "force-dynamic";

export default async function UpgradePage() {
  redirect(upgradeDestination(await getCurrentSession()));
}
