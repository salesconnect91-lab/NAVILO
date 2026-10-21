import { describe, expect, it } from "vitest";
import { assertLocalApiUrl } from "../scripts/phase2b_local_security_tests.mjs";

describe("isolated tenant security runner endpoint guard", () => {
  it("only accepts the local Supabase API on its standard port", () => {
    expect(assertLocalApiUrl("http://localhost:54321")).toBe("http://localhost:54321");
    expect(assertLocalApiUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
  });
  it.each([
    "https://navilo.vercel.app",
    "https://ijdaosaqpbgnqojudjbj.supabase.co",
    "https://localhost:54321",
    "http://example.com:54321",
    "http://127.0.0.1:54322",
    "http://127.0.0.2:54321",
    "http://[::1]:54321",
    "http://127.0.0.1:54321@evil.example:54321",
  ])("rejects non-local or unsafe endpoint %s", (url) => {
    expect(() => assertLocalApiUrl(url)).toThrow();
  });
});
