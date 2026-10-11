import type { CurrentSession } from "./session";

/**
 * Where "Start your free trial" leads. Signed out: sign in first, then come back here.
 * Signed in: the account page, until billing (Plan 2) sends free accounts to Stripe Checkout.
 */
export function upgradeDestination(session: CurrentSession | null): string {
  if (!session) return "/sign-in?next=%2Fupgrade";
  return "/account";
}
