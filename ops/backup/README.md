# NAVILO — Independent local PC backup

This package **prepares** a safe daily backup workflow; it does not install itself or confirm that a backup or restore succeeded. No database password or production data belongs in GitHub.

## One-time setup on the Windows PC

1. Install PostgreSQL 17 client utilities (including `pg_dump` and `pg_restore`). They must appear on the machine's PATH.
2. Choose an encrypted local drive (BitLocker or equivalent) with sufficient space for at least 14 compressed NAVILO backups. Also arrange an independent encrypted offline/offsite copy for disaster recovery.
3. Configure the Windows user environment variables `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` from the approved **read-only backup connection**. Set `PGSSLMODE=verify-full` when root CA validation is configured; the script otherwise enforces encrypted transit with `require`.
4. Store credentials only in `%APPDATA%\postgresql\pgpass.conf` or a user-protected file named by `PGPASSFILE`. Limit that file's Windows ACL to the scheduled user. **Never place a password in a script, task argument, log, repository, or chat.**
5. Download `NAVILO-Daily-Backup.ps1` to a stable local directory. Run manually with the **same Windows user** that will own the scheduled task:
   ```powershell
   powershell.exe -NoProfile -File "C:\NAVILO\NAVILO-Daily-Backup.ps1" -BackupDirectory "D:\NAVILO-Backups" -RetentionDays 14
   ```
6. Check for a completed `.dump` and matching `.sha256` file. Confirm that `pg_restore --list` succeeds (the script checks this). This is **not yet a full restore test**.
7. In Windows Task Scheduler, create a daily task running the command in step 5 under the same Windows account. Enable **Run whether user is logged on or not** and **Run task as soon as possible after a scheduled start is missed**. Test it with **Run** and inspect the history and output. The PC must be powered on and network-connected; missed runs are not equivalent to a cloud backup.
8. Create a **separate, empty** local PostgreSQL database with a name such as `navilo_restore_drill`. Use test-only credentials and no tunnelling/forwarding to the production database. Run the guard-protected restore checker:
   ```powershell
   powershell.exe -NoProfile -File "C:\NAVILO\NAVILO-Verify-Restore.ps1" -Archive "D:\NAVILO-Backups\navilo_YYYYMMDD_HHMMSS.dump" -TestDatabase "navilo_restore_drill"
   ```
   The restore checker verifies SHA256, ensures a localhost target with a strictly named *empty* test database, performs a single-transaction restore, and audits posted-journal balance. A PostgreSQL test environment with compatible extensions and roles may be needed for the full Supabase schema. Record its actual output. Never target production.
9. Compare the restored counts with the original backup-time source snapshot before declaring disaster-recovery readiness.

## Operational safety

- Backups read PostgreSQL; they never change NAVILO production tables or schema.
- A successful archive-list check proves only that the archive can be read, **not** that the data can be restored and reconciled. Use `NAVILO-Verify-Restore.ps1` on a clean local test server.
- If the job fails, retain existing good backups and investigate; the script will not prune them.
- Retention defaults to 14 days. NAVILO was approximately **1.5 GB before compression** at the 21-Oct-2026 audit, so monitor disk space as usage grows.
- If the machine uses Windows Home or the destination is unencrypted, provide equivalent encrypted storage before saving financial data there.
- For point-in-time recovery, separately verify the actual Supabase managed backup/PITR entitlement and restoration path.
