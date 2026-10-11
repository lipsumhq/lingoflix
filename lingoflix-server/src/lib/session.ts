import { headers } from "next/headers";
import { getAuth } from "./auth";

export interface CurrentSession {
  user: { id: string; email: string; name: string };
  /** The raw session token: what /connect hands to the extension (spec §7.3). Never log it. */
  token: string;
}

/** The signed-in learner for this request (server components and route handlers), or null. */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  // headers() first: it marks the page dynamic before Better Auth (and its environment) is touched.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    token: session.session.token,
  };
}
