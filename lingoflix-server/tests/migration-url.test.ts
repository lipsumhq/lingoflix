import { describe, expect, it, vi } from "vitest";
import { migrationConnectionString } from "@/db/migration-url";

const DIRECT = "postgres://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/db?sslmode=verify-full";
const POOLED = "postgres://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/db?sslmode=verify-full";
const LOCAL = "postgres://postgres:postgres@127.0.0.1:5432/lingoflix";
const NOT_SET = "DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set";
const NEEDS_DIRECT = "Migrations need Neon's direct connection: set DATABASE_URL_UNPOOLED (the pooled host ends in -pooler)";

describe("migrationConnectionString", () => {
  it("prefers DATABASE_URL_UNPOOLED", () => {
    expect(migrationConnectionString({ DATABASE_URL_UNPOOLED: DIRECT, DATABASE_URL: POOLED })).toBe(DIRECT);
  });

  it("falls back to DATABASE_URL for a local database", () => {
    expect(migrationConnectionString({ DATABASE_URL: LOCAL })).toBe(LOCAL);
  });

  it("treats empty strings as unset", () => {
    expect(migrationConnectionString({ DATABASE_URL_UNPOOLED: "", DATABASE_URL: LOCAL })).toBe(LOCAL);
    expect(() => migrationConnectionString({ DATABASE_URL_UNPOOLED: "", DATABASE_URL: "" })).toThrow(NOT_SET);
  });

  it("says so when neither is set", () => {
    expect(() => migrationConnectionString({})).toThrow(NOT_SET);
  });

  it("refuses Neon's pooled host, from either variable", () => {
    expect(() => migrationConnectionString({ DATABASE_URL_UNPOOLED: POOLED })).toThrow(NEEDS_DIRECT);
    expect(() => migrationConnectionString({ DATABASE_URL: POOLED })).toThrow(NEEDS_DIRECT);
  });

  it("accepts Neon's direct host", () => {
    expect(migrationConnectionString({ DATABASE_URL_UNPOOLED: DIRECT })).toBe(DIRECT);
    expect(migrationConnectionString({ DATABASE_URL: DIRECT })).toBe(DIRECT);
  });

  it("passes an unparsable value through for pg to report", () => {
    expect(migrationConnectionString({ DATABASE_URL: "not a url" })).toBe("not a url");
  });

  it("reads process.env by default", () => {
    vi.stubEnv("DATABASE_URL_UNPOOLED", DIRECT);
    vi.stubEnv("DATABASE_URL", POOLED);
    expect(migrationConnectionString()).toBe(DIRECT);
  });
});
