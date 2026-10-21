import { describe, expect, it } from "vitest";
import { assertLocalDbUrl, assertSafeRehearsal, SUITES } from "../scripts/navilo_local_launch_acceptance.mjs";

describe("local multi-module launch test guard", () => {
  it("accepts only local postgres 54322", () => {
    expect(assertLocalDbUrl("postgresql://postgres:local@127.0.0.1:54322/postgres").database).toBe("postgres");
  });
  it.each([
    "postgresql://postgres:password@db.ijdaosaqpbgnqojudjbj.supabase.co:5432/postgres",
    "postgresql://postgres:password@127.0.0.1:5432/postgres",
    "postgresql://postgres:password@127.0.0.1:54322/production",
    "https://localhost:54322/postgres",
    "postgresql://postgres:password@10.0.0.1:54322/postgres",
  ])("refuses hosted and other endpoints", value => {
    expect(() => assertLocalDbUrl(value)).toThrow();
  });
  it("requires transaction rollback and forbids COMMIT or includes", () => {
    expect(assertSafeRehearsal("BEGIN;\nSELECT 1;\nROLLBACK;", "good")).toBe(true);
    expect(() => assertSafeRehearsal("BEGIN;\nCOMMIT;", "bad")).toThrow();
    expect(() => assertSafeRehearsal("BEGIN;\n\\i unsafe.sql\nROLLBACK;", "bad")).toThrow();
  });
  it("covers company, sales, purchase, journal, import and reporting flows", () => {
    expect(SUITES.length).toBe(6);
    expect(SUITES.map(([name]: string[]) => name)).toEqual([
      "onboarding","sales_purchase_vat","purchase_returns",
      "journal_permissions","transport_import","transport_reports",
    ]);
  });
});
