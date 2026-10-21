import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const setup = readFileSync(new URL("../ops/backup/NAVILO-Install-BackupTask.ps1", import.meta.url), "utf8");
describe("NAVILO safe Windows task installation", () => {
  it("requires opt-in and typed confirmation", () => {
    expect(setup).toContain("[switch]$Install");
    expect(setup).toContain("PLAN_ONLY");
    expect(setup).toContain('Read-Host');
    expect(setup).toContain('$confirm -cne "INSTALL"');
  });
  it("offers daily primary and hourly standby without overwriting other tasks", () => {
    expect(setup).toContain('"NAVILO-Backup-Primary"');
    expect(setup).toContain('"NAVILO-Backup-Standby"');
    expect(setup).toContain('"/MO","1"');
    expect(setup).toContain("$alreadyInstalled");
    expect(setup).toContain('"/RP","*"');
    expect(setup).not.toContain('"/F"');
  });
  it("preflights an independent backup connection without logging passwords", () => {
    expect(setup).toContain("Assert-SharePath");
    expect(setup).toContain("Assert-LocalPath");
    expect(setup).toContain("pgpass.conf");
    expect(setup).toContain('"pg_dump", "pg_restore", "schtasks.exe"');
  });
});
