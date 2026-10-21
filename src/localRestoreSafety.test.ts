import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../ops/backup/NAVILO-Verify-Restore.ps1", import.meta.url), "utf8");
const daily = readFileSync(new URL("../ops/backup/NAVILO-Daily-Backup.ps1", import.meta.url), "utf8");

describe("local-only backup and restore safety contracts", () => {
  it("forces localhost and a dedicated empty test database before restore", () => {
    expect(script).toContain('ValidatePattern(\'^navilo_restore_');
    expect(script).toContain('$env:PGHOST = "127.0.0.1"');
    expect(script).toContain('EMPTY local test database');
    expect(script).toContain('$check[1] -ne "0"');
    expect(script).toContain("--single-transaction");
    expect(script).not.toContain("--clean");
    expect(script).not.toContain("--create");
  });
  it("checks SHA256 and posted-journal integrity", () => {
    expect(script).toContain("Get-FileHash -Algorithm SHA256");
    expect(script).toContain("pg_restore --list");
    expect(script).toContain("unbalanced_posted_journals");
    expect(script).toContain("posted_without_lines");
  });
  it("never prunes old backups before the latest archive has passed validation", () => {
    const verify = daily.indexOf("pg_restore --list");
    const move = daily.indexOf("Move-Item");
    const retention = daily.indexOf("Get-ChildItem");
    expect(verify).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(verify);
    expect(retention).toBeGreaterThan(move);
    expect(daily).toContain("$complete = $true");
  });
});
