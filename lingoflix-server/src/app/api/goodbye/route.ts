import { getDb } from "@/db/client";
import { createGoodbyeHandler } from "@/lib/goodbye";

export const POST = createGoodbyeHandler(getDb);
