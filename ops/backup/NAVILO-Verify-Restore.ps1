# NAVILO isolated restore drill (never restores to production).
# Prerequisites: PostgreSQL 17 client, a SEPARATE empty local test database,
# test-only PostgreSQL credentials, and the encrypted backup archive from NAVILO-Daily-Backup.ps1.
# Usage: powershell.exe -NoProfile -File .\NAVILO-Verify-Restore.ps1 -Archive "D:\NAVILO-Backups\navilo_YYYYMMDD_HHMMSS.dump" -TestDatabase navilo_restore_drill
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^navilo_restore_[A-Za-z0-9_]{1,40}$')]
  [string]$TestDatabase,
  [string]$TestUser = "postgres",
  [ValidateRange(1024,65535)][int]$TestPort = 5432
)
$ErrorActionPreference = "Stop"
try {
  $archivePath = (Resolve-Path -LiteralPath $Archive -ErrorAction Stop).Path
  if (-not [System.IO.Path]::GetFileName($archivePath).StartsWith("navilo_") -or
      -not $archivePath.EndsWith(".dump", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing non-NAVILO archive. Expected navilo_*.dump."
  }
  foreach ($bin in @("pg_restore", "psql")) {
    if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
      throw "Required PostgreSQL utility not found: $bin"
    }
  }

  $hashPath = $archivePath + ".sha256"
  if (-not (Test-Path -LiteralPath $hashPath -PathType Leaf)) {
    throw "SHA256 sidecar is missing. Refusing to restore unverified archive."
  }
  $saved = (Get-Content -LiteralPath $hashPath -TotalCount 1).Trim()
  if ($saved -notmatch '^([0-9a-fA-F]{64})\s+') {
    throw "Invalid backup SHA256 sidecar."
  }
  $expectedHash = $Matches[1].ToLowerInvariant()
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw "Backup archive SHA256 verification FAILED." }

  & pg_restore --list "$archivePath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup archive format check failed." }

  # Force local connection even if this PC normally uses production PGHOST.
  # Do not use a network hostname or allow a user to override the destination.
  $env:PGHOST = "127.0.0.1"
  $env:PGPORT = [string]$TestPort
  $env:PGDATABASE = $TestDatabase
  $env:PGUSER = $TestUser
  $env:PGSSLMODE = "prefer"
  $env:PGCONNECT_TIMEOUT = "8"
  $env:PGAPPNAME = "navilo_isolated_restore_drill"
  # A pgpass.conf entry for THIS LOCAL TEST SERVER is recommended.
  # Do not point tunnels/port forwarding to production.
  $preflightSql = "SELECT current_database() || '|' || (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S'));"
  $preflight = & psql -X --no-psqlrc -A -t -v ON_ERROR_STOP=1 -c $preflightSql
  if ($LASTEXITCODE -ne 0) { throw "Could not verify the isolated local test database." }
  $check = ([string]($preflight | Select-Object -Last 1)).Trim().Split("|")
  if ($check.Count -ne 2 -or $check[0] -cne $TestDatabase -or $check[1] -ne "0") {
    throw "Refusing restore: destination must be the named, EMPTY local test database."
  }

  Write-Output ("Restoring into a verified empty LOCAL test database: " + $TestDatabase)
  & pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$TestDatabase" "$archivePath"
  if ($LASTEXITCODE -ne 0) {
    throw "Restore failed. Inspect the isolated test environment; production was not targeted."
  }

  $verifySql = @'
SELECT json_build_object(
  'companies', (SELECT count(*) FROM public.companies),
  'posted_journals', (SELECT count(*) FROM public.journal_entries WHERE status='posted'),
  'journal_lines', (SELECT count(*) FROM public.journal_lines),
  'unbalanced_posted_journals', (
    SELECT count(*) FROM (
      SELECT j.id
      FROM public.journal_entries j
      JOIN public.journal_lines l ON l.entry_id=j.id
      WHERE j.status='posted'
      GROUP BY j.id
      HAVING abs(sum(coalesce(l.base_debit,l.debit,0)-coalesce(l.base_credit,l.credit,0)))>0.01
    ) mismatch
  ),
  'posted_without_lines', (
    SELECT count(*) FROM public.journal_entries j
    WHERE j.status='posted' AND NOT EXISTS (
      SELECT 1 FROM public.journal_lines l WHERE l.entry_id=j.id
    )
  )
)::text;
'@
  $result = & psql -X --no-psqlrc -A -t -v ON_ERROR_STOP=1 -c $verifySql
  if ($LASTEXITCODE -ne 0) { throw "Post-restore journal integrity query failed." }
  $line = [string]($result | Select-Object -Last 1)
  $metrics = $line | ConvertFrom-Json
  if ($null -eq $metrics.companies -or $null -eq $metrics.posted_journals -or
      $null -eq $metrics.journal_lines -or
      [long]$metrics.unbalanced_posted_journals -ne 0 -or
      [long]$metrics.posted_without_lines -ne 0) {
    throw "Post-restore accounting checks FAILED. Investigate the isolated database."
  }
  Write-Output ("PASS: SHA256 + archive format + isolated restore + journal integrity.")
  Write-Output ("Test database: " + $TestDatabase)
  Write-Output ("Restore metrics: " + $line)
  Write-Output "Compare these counts against the date/time-matched source snapshot before declaring disaster-recovery readiness."
} catch {
  Write-Warning ("NAVILO restore drill failed: " + $_.Exception.Message)
  exit 1
}
