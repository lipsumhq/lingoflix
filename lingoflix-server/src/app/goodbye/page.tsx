import type { Metadata } from "next";
import Link from "next/link";
import { GoodbyeForm } from "./GoodbyeForm";

export const metadata: Metadata = { title: "Sorry to see you go" };

/** Opened by Chrome when LingoFlix is uninstalled (spec §7.7). */
export default function GoodbyePage() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-3xl font-black tracking-tight">Sorry to see you go</h1>
      <p className="mt-2">If you have a moment, tell us why. It helps us make LingoFlix better.</p>

      <div className="mt-8">
        <GoodbyeForm />
      </div>

      <p className="mt-10">
        {"Uninstalling LingoFlix doesn't cancel Premium. "}
        <Link href="/account" className="font-bold underline">
          Manage or cancel it from your account.
        </Link>
      </p>
    </div>
  );
}
