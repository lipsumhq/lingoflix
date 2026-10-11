"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Sign-in from the site's pages; same origin as /api/auth, so no baseURL is needed. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
