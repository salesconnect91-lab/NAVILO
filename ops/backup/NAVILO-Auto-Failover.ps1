# NAVILO automatic PC1 -> PC2 backup failover. PowerShell 5.1+.
# PRIMARY: create a verified local dump, then publish a complete copy to a PC2-owned SMB inbox.
# STANDBY: hourly check primary inbox + own directory; back up directly only when neither has a fresh verified archive.
# No database writes. Neither PC changes the NAVILO application's live backup settings.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet("Primary","Standby")][string]$Mode,
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [Parameter(Mandatory=$true)][string]$MirrorDirectory,
  [ValidateRange(2,72)][int]$MaxAgeHours = 25,
  [ValidateRange(2,365)][int]$RetentionDays = 14,
  [string]$DailyBackupScript = "",
  [switch]$DecisionOnly
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($DailyBackupScript)) {
  $DailyBackupScript = Join-Path -Path (Split-Path -Parent $MyInvocation.MyCommand.Path) -ChildPath "NAVILO-Daily-Backup.ps1"
}
$mutex = $null
$locked = $false

function Get-VerifiedArchive([string]$archiveFile) {
  $filename = [System.IO.Path]::GetFileName($archiveFile)
  if ($filename -notmatch '^navilo_(\d{8})_(\d{6})\.dump$') { return $null }
  $stamp = $Matches[1] + $Matches[2]
  try {
    $when = [DateTime]::ParseExact($stamp, "yyyyMMddHHmmss",
      [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
  } catch { return $null }
  if ($when -gt (Get-Date).AddMinutes(10)) { return $null }
  $hashFile = $archiveFile + ".sha256"
  if (-not (Test-Path -LiteralPath $archiveFile -PathType Leaf) -or
      -not (Test-Path -LiteralPath $hashFile -PathType Leaf)) { return $null }
  if ((Get-Item -LiteralPath $archiveFile).Length -lt 1024) { return $null }
  $sidecar = (Get-Content -LiteralPath $hashFile -TotalCount 1).Trim()
  $expectedPattern = '^([0-9a-fA-F]{64})\s{2}' + [regex]::Escape($filename) + '$'
  if ($sidecar -notmatch $expectedPattern) { return $null }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archiveFile).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { return $null }
  return [pscustomobject]@{ Path=$archiveFile; Timestamp=$when; Sha256=$actual }
}

function Get-FreshArchive([string]$directory, [DateTime]$cutoff) {
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return $null }
  $files = @(Get-ChildItem -LiteralPath $directory -File -Filter "navilo_*.dump" |
    Sort-Object Name -Descending)
  foreach ($file in $files) {
    # Cheap timestamp check first, expensive SHA256 only for potentially fresh files.
    if ($file.Name -notmatch '^navilo_(\d{8})_(\d{6})\.dump$') { continue }
    try {
      $when = [DateTime]::ParseExact(($Matches[1] + $Matches[2]), "yyyyMMddHHmmss",
        [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
    } catch { continue }
    if ($when -lt $cutoff) { break }
    $archive = Get-VerifiedArchive $file.FullName
    if ($null -ne $archive -and $archive.Timestamp -ge $cutoff) { return $archive }
  }
  return $null
}

function Run-DailyBackup([string]$directory) {
  if (-not (Test-Path -LiteralPath $DailyBackupScript -PathType Leaf)) {
    throw "NAVILO-Daily-Backup.ps1 was not found."
  }
  # Run existing audited pg_dump + pg_restore --list procedure in a child process.
  # If it fails, no new backup will be announced or copied.
  $out = @(& powershell.exe -NoProfile -NonInteractive -File $DailyBackupScript -BackupDirectory $directory -RetentionDays $RetentionDays 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "pg_dump verification failed; see local Windows scheduled-task logs." }
  $successful = @($out | ForEach-Object { [string]$_ } |
    Where-Object { $_ -match '^PASS: Local archive created and format checked: (.+\.dump)$' })
  if ($successful.Count -ne 1) { throw "Backup script did not report exactly one completed archive." }
  $archivePath = $successful[0] -replace '^PASS: Local archive created and format checked: ', ''
  $verified = Get-VerifiedArchive $archivePath
  if ($null -eq $verified) { throw "New local backup failed SHA256 verification." }
  return $verified
}

function Publish-Mirror($backup) {
  # This MUST be the dedicated PC2-owned encrypted SMB share (not a PC1 share).
  if ($MirrorDirectory -notmatch '^\\\\[^\\]+\\[^\\]+(?:\\.*)?$') {
    throw "Primary mirror must be a PC2 SMB UNC share, e.g. \\PC2\NAVILO-Inbox."
  }
  if (-not (Test-Path -LiteralPath $MirrorDirectory -PathType Container)) {
    throw "PC2 inbox is unavailable; primary local backup remains intact."
  }
  $name = [System.IO.Path]::GetFileName($backup.Path)
  $destination = Join-Path $MirrorDirectory $name
  if ((Test-Path -LiteralPath $destination) -or
      (Test-Path -LiteralPath ($destination + ".sha256"))) {
    $old = Get-VerifiedArchive $destination
    if ($null -ne $old -and $old.Sha256 -eq $backup.Sha256) {
      Write-Output ("PRIMARY_ALREADY_MIRRORED " + $name)
      return
    }
    throw "Conflicting archive name exists on PC2; refusing to overwrite."
  }
  $id = [guid]::NewGuid().ToString("N")
  $stage = Join-Path $MirrorDirectory ("." + $name + "." + $id + ".partial")
  $sidecarStage = $stage + ".sha256"
  try {
    Copy-Item -LiteralPath $backup.Path -Destination $stage -ErrorAction Stop
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $stage).Hash.ToLowerInvariant() -ne $backup.Sha256) {
      throw "Mirror copy checksum mismatch."
    }
    Copy-Item -LiteralPath ($backup.Path + ".sha256") -Destination $sidecarStage -ErrorAction Stop
    # Archive first, sidecar LAST. PC2 only trusts paired, hashed archives.
    Move-Item -LiteralPath $stage -Destination $destination -ErrorAction Stop
    Move-Item -LiteralPath $sidecarStage -Destination ($destination + ".sha256") -ErrorAction Stop
    if ($null -eq (Get-VerifiedArchive $destination)) { throw "Published archive verification failed." }
    Write-Output ("PRIMARY_MIRRORED " + $name)
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Force }
    if (Test-Path -LiteralPath $sidecarStage) { Remove-Item -LiteralPath $sidecarStage -Force }
  }
}

try {
  if ($Mode -eq "Standby" -and $MirrorDirectory -notmatch '^[A-Za-z]:\\') {
    throw "Standby must check a LOCAL PC2 mirror directory (not a network share)."
  }
  if ($Mode -eq "Primary" -and $DecisionOnly) {
    throw "DecisionOnly is supported only in Standby mode."
  }
  $mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList @($false, ("Local\NAVILO_Backup_" + $Mode))
  try { $locked = $mutex.WaitOne(0, $false) }
  catch [System.Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw "Another NAVILO backup job is already running on this PC." }

  if ($Mode -eq "Primary") {
    $archive = Run-DailyBackup $BackupDirectory
    Write-Output ("PRIMARY_LOCAL_PASS " + $archive.Path)
    Publish-Mirror $archive
    exit 0
  }

  # PC2 standalone: no dependency on PC1's power or network after an archive is mirrored.
  # Use the greater of the most recent verified PC1 mirror and PC2 failover archive.
  $cutoff = (Get-Date).AddHours(-$MaxAgeHours)
  $primary = Get-FreshArchive $MirrorDirectory $cutoff
  $own = Get-FreshArchive $BackupDirectory $cutoff
  if ($null -ne $primary -or $null -ne $own) {
    Write-Output "STANDBY_SKIP Fresh verified backup already exists on PC2."
    exit 0
  }
  if ($DecisionOnly) {
    Write-Output "STANDBY_BACKUP_REQUIRED No recent verified backup on PC2."
    exit 0
  }
  $archive = Run-DailyBackup $BackupDirectory
  Write-Output ("STANDBY_FAILOVER_PASS " + $archive.Path)
  exit 0
} catch {
  Write-Error ("NAVILO_FAILOVER_ERROR: " + $_.Exception.Message)
  exit 1
} finally {
  if ($locked -and $mutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
