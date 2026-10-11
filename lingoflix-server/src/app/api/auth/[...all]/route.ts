import { getAuth } from "@/lib/auth";

// Better Auth's endpoints (spec §5.4). getAuth() runs per request, never at import, so builds need no secrets.

export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
