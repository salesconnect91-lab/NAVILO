# NAVILO automatic backup Windows Task Scheduler installer.
# Generates a safe dry-run plan by default. -Install prompts before changing this PC.
# Install separately while signed in as the dedicated Windows backup account on each computer.
# Passwords are requested by Windows Task Scheduler; they are NOT accepted as script parameters.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet("Primary","Standby")][string]$Role,
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [Parameter(Mandatory=$true)][string]$MirrorDirectory,
  [string]$StartAt = "",
  [ValidateRange(2,72)][int]$MaxAgeHours = 25,
  [ValidateRange(2,365)][int]$RetentionDays = 14,
  [switch]$Install
)
$ErrorActionPreference = "Stop"

function Assert-LocalPath([string]$value) {
  if ($value -notmatch '^[A-Za-z]:\\[^"<>|%&^]*$' -or
      $value.Contains("..") -or $value.Contains([char]10) -or $value.Contains([char]13)) {
    throw "Expected a safe absolute local drive path. Example: D:\NAVILO-Primary."
  }
}
function Assert-SharePath([string]$value) {
  if ($value -notmatch '^\\\\[^\\/:*?"<>|%&^]+\\[^\\/:*?"<>|%&^]+$' -or
      $value.Contains("..") -or $value.Contains([char]10)) {
    throw "Primary mirror must be a dedicated PC2 UNC share. Example: \\PC2\NAVILO-Inbox."
  }
}

Assert-LocalPath $BackupDirectory
if ($Role -eq "Primary") { Assert-SharePath $MirrorDirectory }
else { Assert-LocalPath $MirrorDirectory }
if (-not $StartAt) { $StartAt = if ($Role -eq "Primary") { "01:00" } else { "02:00" } }
if ($StartAt -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') {
  throw "StartAt must use HH:mm, e.g. 01:00."
}

$path = Join-Path $PSScriptRoot "NAVILO-Auto-Failover.ps1"
$daily = Join-Path $PSScriptRoot "NAVILO-Daily-Backup.ps1"
$name = if ($Role -eq "Primary") { "NAVILO-Backup-Primary" } else { "NAVILO-Backup-Standby" }
$when = if ($Role -eq "Primary") { "DAILY" } else { "HOURLY" }
$account = (& whoami.exe).Trim()
if (-not $account) { throw "Cannot determine current Windows account." }
$cmd = 'powershell.exe -NoProfile -NonInteractive -File "' + $path + '" -Mode ' + $Role +
  ' -BackupDirectory "' + $BackupDirectory + '" -MirrorDirectory "' + $MirrorDirectory +
  '" -RetentionDays ' + $RetentionDays
if ($Role -eq "Standby") { $cmd += ' -MaxAgeHours ' + $MaxAgeHours }

Write-Output ("NAVILO_BACKUP_TASK_PLAN Role=" + $Role)
Write-Output ("Task=" + $name + " Interval=" + $when + " StartAt=" + $StartAt)
Write-Output ("Account=" + $account + " BackupDir=" + $BackupDirectory + " MirrorDir=" + $MirrorDirectory)
Write-Output "No changes have been made yet."
if (-not $Install) {
  Write-Output "PLAN_ONLY: Re-run with -Install to confirm and register the Windows task."
  exit 0
}

if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
    -not (Test-Path -LiteralPath $daily -PathType Leaf)) {
  throw "NAVILO scripts missing. Copy daily backup and auto-failover scripts into the same local folder."
}
foreach ($binary in @("pg_dump", "pg_restore", "schtasks.exe")) {
  if (-not (Get-Command $binary -ErrorAction SilentlyContinue)) {
    throw ("Missing required backup or Windows scheduler utility: " + $binary)
  }
}
foreach ($key in @("PGHOST","PGDATABASE","PGUSER")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) {
    throw ("Missing PC-local environment variable: " + $key)
  }
}
$passFile = if ($env:PGPASSFILE) { $env:PGPASSFILE }
            else { Join-Path $env:APPDATA "postgresql\pgpass.conf" }
if (-not (Test-Path -LiteralPath $passFile -PathType Leaf)) {
  throw "Local pgpass.conf is missing. Configure a restricted file for THIS task user; do not share the password."
}
if (-not (Test-Path -LiteralPath $BackupDirectory -PathType Container)) {
  throw "Backup directory must be created manually on an encrypted drive before installation."
}
if (-not (Test-Path -LiteralPath $MirrorDirectory -PathType Container)) {
  throw "Mirrored PC2 inbox is unavailable. Validate SMB or local PC2 path first."
}
# Only one backup-task registration per role. Never overwrite unknown task settings.
$previousEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  & schtasks.exe /Query /TN $name *> $null
  $alreadyInstalled = $LASTEXITCODE -eq 0
} finally { $ErrorActionPreference = $previousEap }
if ($alreadyInstalled) {
  throw ("Scheduled task '" + $name + "' already exists. Inspect/disable it before installing again.")
}
$confirm = Read-Host ("Type INSTALL to register '" + $name + "' for " + $account)
if ($confirm -cne "INSTALL") { throw "User declined task installation. Nothing was registered." }

$args = @("/Create","/TN",$name,"/TR",$cmd,"/SC",$when,"/ST",$StartAt,
          "/RU",$account,"/RP","*")
if ($Role -eq "Standby") { $args += @("/MO","1") }
Write-Output "Windows will now ask for the current Windows account PASSWORD (not your NAVILO password)."
Write-Output "Credentials are requested directly by schtasks.exe; never send them in chat."
& schtasks.exe @args
if ($LASTEXITCODE -ne 0) { throw "Windows Task Scheduler rejected task creation." }
Write-Output ("TASK_INSTALLED " + $name)
Write-Output "Use Task Scheduler to enable: Run whether user is logged on or not; Run as soon as possible after a missed start; Do not start a new instance."
Write-Output "Then manually Run the task, inspect its exit code and verify an actual .dump/.sha256 on both PCs."
