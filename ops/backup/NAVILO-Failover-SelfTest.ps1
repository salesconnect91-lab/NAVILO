# Offline decision-only verification: runs on a Windows PC or GitHub Windows runner.
# No database connection, no real customer backup, no cloud credentials.
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$driver = Join-Path $PSScriptRoot "NAVILO-Auto-Failover.ps1"
$root = Join-Path $env:TEMP ("NAVILO-FailoverTest-" + [guid]::NewGuid().ToString("N"))
$mirror = Join-Path $root "PC2-Inbox"
$own = Join-Path $root "PC2-Standby"
New-Item -ItemType Directory -Force -Path $mirror,$own | Out-Null

function Add-Fixture([string]$folder, [DateTime]$when, [bool]$valid = $true) {
  $name = "navilo_" + $when.ToString("yyyyMMdd_HHmmss") + ".dump"
  $file = Join-Path $folder $name
  [byte[]]$bytes = New-Object byte[] 2048
  (New-Object System.Random).NextBytes($bytes)
  [IO.File]::WriteAllBytes($file, $bytes)
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
  if (-not $valid) { $hash = "0" * 64 }
  [IO.File]::WriteAllText(($file + ".sha256"), ($hash + "  " + $name))
  return $file
}
function Assert-Decision([string]$expected) {
  $result = @(& powershell.exe -NoProfile -NonInteractive -File $driver -Mode Standby -BackupDirectory $own -MirrorDirectory $mirror -MaxAgeHours 25 -DecisionOnly 2>&1)
  $code = $LASTEXITCODE
  if ($code -ne 0 -or (-not (($result -join [Environment]::NewLine).Contains($expected)))) {
    throw ("Expected " + $expected + " but exit code was " + $code + ": " + ($result -join " | "))
  }
  Write-Output ("PASS " + $expected)
}
function Clean-TestFiles([string]$folder) {
  Get-ChildItem -LiteralPath $folder -File | Remove-Item -Force
}

try {
  $primary = Add-Fixture $mirror ((Get-Date).AddMinutes(-10))
  Assert-Decision "STANDBY_SKIP"

  Clean-TestFiles $mirror
  $corrupt = Add-Fixture $mirror ((Get-Date).AddMinutes(-10)) $false
  Assert-Decision "STANDBY_BACKUP_REQUIRED"

  Clean-TestFiles $mirror
  $stale = Add-Fixture $mirror ((Get-Date).AddHours(-28))
  Assert-Decision "STANDBY_BACKUP_REQUIRED"

  $secondary = Add-Fixture $own ((Get-Date).AddMinutes(-4))
  Assert-Decision "STANDBY_SKIP"

  Clean-TestFiles $mirror
  Assert-Decision "STANDBY_SKIP"

  Clean-TestFiles $own
  Assert-Decision "STANDBY_BACKUP_REQUIRED"

  Write-Output "PASS: NAVILO PC1-to-PC2 decision-only failover tests completed."
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
