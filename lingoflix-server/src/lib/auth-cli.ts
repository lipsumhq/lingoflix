import { getAuth } from "./auth";

// Only for the Better Auth CLI (`pnpm --filter lingoflix-server auth:check`), which needs a module exporting
// `auth`. It builds the real auth from the environment at import, so never import this file from app code.
export const auth = getAuth();
