# NAVILO read-only daily local PostgreSQL backup (Windows PowerShell 5.1+).
# Schedule this on the operator's own PC; this script NEVER changes the source database.
# Requires PostgreSQL pg_dump/pg_restore on PATH, and PGPASSFILE on the PC (never in Git).
[CmdletBinding()]
param(
  [string]$BackupDirectory = (Join-Path $env:USERPROFILE "NAVILO-Backups"),
  [ValidateRange(2,365)][int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
$archive = $null
$partial = $null
$complete = $false
try {
  foreach ($name in @("PGHOST", "PGDATABASE", "PGUSER")) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      throw "Missing $name. Configure a read-only PostgreSQL backup connection in this PC's user environment."
    }
  }
  if (-not $env:PGPORT) { $env:PGPORT = "5432" }
  if (-not $env:PGSSLMODE) { $env:PGSSLMODE = "require" }
  $env:PGCONNECT_TIMEOUT = "15"
  $env:PGAPPNAME = "navilo_local_daily_backup"
  if (-not $env:PGPASSFILE) {
    $env:PGPASSFILE = Join-Path $env:APPDATA "postgresql\pgpass.conf"
  }
  if (-not (Test-Path -LiteralPath $env:PGPASSFILE -PathType Leaf)) {
    throw "A local pgpass.conf file is required at $($env:PGPASSFILE). Do not put a password in this script or a scheduled-task command."
  }
  foreach ($bin in @("pg_dump", "pg_restore")) {
    if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
      throw "$bin was not found. Install PostgreSQL client tools and add them to PATH."
    }
  }

  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $archive = Join-Path $BackupDirectory ("navilo_" + $stamp + ".dump")
  $partial = $archive + ".partial"

  # pg_dump uses a transactionally consistent source snapshot.
  & pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$partial"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE." }
  if (-not (Test-Path -LiteralPath $partial -PathType Leaf) -or (Get-Item -LiteralPath $partial).Length -le 1024) {
    throw "Backup is empty or too small."
  }

  # Basic archive-format check only; a separate isolated restore drill is still mandatory.
  & pg_restore --list "$partial" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pg_restore could not list the archive." }
  Move-Item -LiteralPath $partial -Destination $archive -ErrorAction Stop
  $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  Set-Content -LiteralPath ($archive + ".sha256") -Value ($sha + "  " + (Split-Path -Leaf $archive)) -Encoding ASCII

  # Delete only our own old completed backups, and only after a new backup passed.
  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  Get-ChildItem -LiteralPath $BackupDirectory -File -Filter "navilo_*.dump" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      $oldHash = $_.FullName + ".sha256"
      Remove-Item -LiteralPath $_.FullName -Force
      if (Test-Path -LiteralPath $oldHash) { Remove-Item -LiteralPath $oldHash -Force }
    }
  $complete = $true
  Write-Output ("PASS: Local archive created and format checked: " + $archive)
} catch {
  Write-Warning ("NAVILO backup failed: " + $_.Exception.Message)
  exit 1
} finally {
  if (-not $complete -and $partial -and (Test-Path -LiteralPath $partial)) {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  }
}
