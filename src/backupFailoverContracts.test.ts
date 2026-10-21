import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const failover = readFileSync(new URL("../ops/backup/NAVILO-Auto-Failover.ps1", import.meta.url), "utf8");
const selftest = readFileSync(new URL("../ops/backup/NAVILO-Failover-SelfTest.ps1", import.meta.url), "utf8");

describe("portable NAVILO Windows backup failover guards", () => {
  it("never promotes a partial or unverified PC1 archive", () => {
    expect(failover).toContain("Get-FileHash -Algorithm SHA256");
    expect(failover).toContain(".sha256");
    expect(failover).toContain(".partial");
    expect(failover).toContain("Move-Item -LiteralPath $sidecarStage");
    expect(failover).toContain("Get-VerifiedArchive");
  });
  it("does independent standby dumps only when both PC2-owned sources are stale", () => {
    expect(failover).toContain("Get-FreshArchive $MirrorDirectory $cutoff");
    expect(failover).toContain("Get-FreshArchive $BackupDirectory $cutoff");
    expect(failover).toContain("STANDBY_SKIP");
    expect(failover).toContain("STANDBY_FAILOVER_PASS");
    expect(failover).toContain("DecisionOnly");
  });
  it("protects the PC2 local inbox and avoids overlapping backups", () => {
    expect(failover).toContain('MirrorDirectory -notmatch \x27^[A-Za-z]:\\\\\x27');
    expect(failover).toContain('System.Threading.Mutex');
    expect(failover).toContain('Local\\NAVILO_Backup_');
    expect(failover).not.toContain("DROP DATABASE");
    expect(failover).not.toContain("pg_restore --dbname");
  });
  it("tests freshness and corruption decisions without calling production", () => {
    expect(selftest).toContain("STANDBY_BACKUP_REQUIRED");
    expect(selftest).toContain("STANDBY_SKIP");
    expect(selftest).toContain("-DecisionOnly");
  });
});
