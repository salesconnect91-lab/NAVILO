# NAVILO — Automatic PC1 → PC2 database backup failover

**Purpose:** PC1 normally creates a verified daily NAVILO PostgreSQL backup. A completed backup is mirrored to a **PC2-owned** local directory over a restricted Windows SMB share. PC2 runs a check every hour; if neither a verified PC1 copy nor a verified PC2 backup is less than 25 hours old, PC2 runs its own backup directly against Supabase.

**Failover is not instant.** With a daily primary run around 01:00, a 25-hour freshness threshold and hourly PC2 checks, a missed PC1 run generally triggers PC2 at the first hourly check after the threshold. Both computers must have working internet access when they need to contact Supabase. PC2 must remain powered on and the scheduled task must be enabled. If both PCs are off or the database is unavailable, neither can make a new backup. An independent offsite encrypted backup remains necessary.

## Data path

```text
NAVILO Supabase PostgreSQL --read-only pg_dump--> PC1: D:\NAVILO-Primary
                                          |
                                          +--verified .dump + .sha256 via encrypted SMB--> PC2: D:\NAVILO-Inbox
                                                                                           |
                                                              PC2 hourly freshness check -+
                                                                                           | (stale or missing)
NAVILO Supabase PostgreSQL --read-only pg_dump--> PC2: D:\NAVILO-Standby <----------------+
```

## Install once on both Windows computers

1. Install compatible PostgreSQL command-line client tools (`pg_dump`, `pg_restore`) on both PCs and ensure both have sufficient storage and reliable Internet. **The PC2 PostgreSQL backup connection must be independently configured before any outage.**
2. Encrypt both computers' backup disks (BitLocker or equivalent). The existing `.dump` format is compressed, **not file-level encrypted**. Restrict NTFS access to the dedicated backup operator account. Avoid synced consumer-cloud folders with broad sharing.
3. On each PC create a local `C:\NAVILO` directory and copy `NAVILO-Daily-Backup.ps1`, `NAVILO-Auto-Failover.ps1` and the optional `NAVILO-Verify-Restore.ps1` there.
4. For each Windows scheduled-task account, configure database `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE` and a restrictive **local** `PGPASSFILE` (or `%APPDATA%\postgresql\pgpass.conf`). The credentials are for read-only PostgreSQL backup access. Do not send passwords to ChatGPT or store them in GitHub/scripts/task arguments.
5. On PC2 create **local** directories `D:\NAVILO-Inbox` and `D:\NAVILO-Standby`. Share only `D:\NAVILO-Inbox` as `\\PC2\NAVILO-Inbox` with SMB encryption enabled and allow PC1's dedicated account write access. Grant PC2 backup operator read access and limit all other users. Never expose SMB directly to the public Internet; use a secure VPN when PCs are in separate sites. Keep the shared directory on PC2, never PC1, so a PC1 outage does not cut off PC2's freshness evidence.
6. On PC1 create `D:\NAVILO-Primary`. Confirm that PC1 can create files in `\\PC2\NAVILO-Inbox` with the same account its scheduled task will use.

## Task Scheduler: PC1 main task

Use **Create Task** (not Basic Task), run as the dedicated backup Windows account, select **Run whether user is logged on or not**, enable missed-start recovery, and set the task to **not start a new instance**. Example: once daily at 01:00 local time.

**Program:** `powershell.exe`

**Arguments:**

```powershell
-NoProfile -NonInteractive -File "C:\NAVILO\NAVILO-Auto-Failover.ps1" -Mode Primary -BackupDirectory "D:\NAVILO-Primary" -MirrorDirectory "\\PC2\NAVILO-Inbox" -RetentionDays 14
```

The task first creates/validates a local backup and only then publishes the paired `.dump` + `.sha256` to PC2. An unavailable PC2 share causes the PC1 task to report failure, but the existing good local backup is retained. PC1 recovery alone never deletes PC2 standby backups.

## Task Scheduler: PC2 automatic standby task

Run as PC2's dedicated backup Windows account. Configure a trigger **every 1 hour**, starting for example at 02:00, and select **Do not start a new instance**. Set the task to run after a missed start whenever possible.

**Program:** `powershell.exe`

**Arguments:**

```powershell
-NoProfile -NonInteractive -File "C:\NAVILO\NAVILO-Auto-Failover.ps1" -Mode Standby -BackupDirectory "D:\NAVILO-Standby" -MirrorDirectory "D:\NAVILO-Inbox" -MaxAgeHours 25 -RetentionDays 14
```

PC2 checks the original backup timestamp in the **filename** and verifies its SHA256 sidecar. A partial or corrupted mirror never qualifies as fresh. PC2 checks its own previously verified backup too, so it does **not** create a dump every hour while PC1 remains offline. When PC1 resumes, fresh mirrored copies regain priority automatically. Two backups created close together are harmless read-only dumps; both use a local mutex to avoid same-PC overlap.

## Test the failover before relying on it

1. On any Windows PC run offline decision tests: `powershell.exe -NoProfile -File C:\NAVILO\NAVILO-Failover-SelfTest.ps1`. These need no database credentials and must print `PASS` for fresh, corrupt, stale, and missing mirrors.
2. Manually run PC1 Task Scheduler task. Require `PRIMARY_LOCAL_PASS` and `PRIMARY_MIRRORED`, then verify that PC2's `D:\NAVILO-Inbox` contains a `.dump` and `.sha256`.
3. On PC2, test check-only mode: `powershell.exe -NoProfile -File C:\NAVILO\NAVILO-Auto-Failover.ps1 -Mode Standby -BackupDirectory D:\NAVILO-Standby -MirrorDirectory D:\NAVILO-Inbox -DecisionOnly` — with a fresh mirrored copy it must print `STANDBY_SKIP`.
4. Temporarily **disable only PC1's backup scheduled task**, not its database or NAVILO. Use test-only `-MaxAgeHours 2` on PC2 after enough time, or wait for the normal 25-hour threshold; then verify `STANDBY_FAILOVER_PASS` with a NEW direct PC2 dump. Reenable PC1 after the test. Never edit production accounting or delete valid backups for testing.
5. Independently test recovery using `NAVILO-Verify-Restore.ps1` into a completely separate local test database. Verify restored row counts and journal integrity. A good checksum alone is NOT a restore test.
6. Configure monitoring for any task failure and for missing new backups after 26–30 hours. This script logs status to Task Scheduler output, but **does not itself send alerts**.

## Moving the main PC later

To replace PC1, install the same tools/script/backup DB credentials on the replacement computer, set up its SMB permission to the existing PC2 inbox, test one mirrored backup and only then disable the old PC1 task. If the old PC1 is dead, PC2 continues on its own; no NAVILO production schema/settings change is necessary.

**Constraints:** Database backup does not automatically preserve Supabase Storage objects or third-party files, and no system can guarantee zero downtime or recover data that was never successfully backed up. Verify Supabase's separate platform/PITR policy. This repository change prepares portable scripts; it does **not** remotely install tasks on your PCs.
