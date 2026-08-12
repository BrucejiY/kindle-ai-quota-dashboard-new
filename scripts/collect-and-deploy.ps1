# collect-and-deploy.ps1
# One-shot: load .env -> collect -> build -> push to gh-pages
# Designed to be called by Windows Task Scheduler every 10 minutes.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\collect-and-deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\collect-and-deploy.ps1 -SkipDeploy
#
# Logs to logs\collect-and-deploy.log (auto-rotated).

[CmdletBinding()]
param(
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'

# Switch to project root (parent of script dir)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

# Prepare log directory
$LogDir = Join-Path $ProjectRoot 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir 'collect-and-deploy.log'

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# Simple log rotation: if > 1MB, rotate
if (Test-Path $LogFile) {
  $size = (Get-Item $LogFile).Length
  if ($size -gt 1MB) {
    Move-Item $LogFile ($LogFile + '.bak') -Force
  }
}

Write-Log "==== start (SkipDeploy=$SkipDeploy) ===="

# 1) Load .env into current process env vars
$EnvFile = Join-Path $ProjectRoot '.env'
if (-not (Test-Path $EnvFile)) {
  Write-Log "ERROR: .env not found at $EnvFile"
  exit 1
}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line) { return }
  if ($line.StartsWith('#')) { return }
  $parts = $line -split '=', 2
  if ($parts.Length -eq 2) {
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    Set-Item -Path "env:$name" -Value $value
  }
}
Write-Log "loaded .env (ZHIPU_API_KEY len=$($env:ZHIPU_API_KEY.Length), DEEPSEEK_API_KEY len=$($env:DEEPSEEK_API_KEY.Length))"

# 2) Collect
Write-Log "run npm run collect ..."
& npm.cmd run collect 2>&1 | ForEach-Object {
  $out = ($_ -replace "^\s+$", "").TrimEnd()
  if ($out) { Write-Log "  $out" }
}
if ($LASTEXITCODE -ne 0) {
  Write-Log "ERROR: collect failed (exit=$LASTEXITCODE)"
  exit 2
}

# 3) Build
Write-Log "run npm run build ..."
& npm.cmd run build 2>&1 | ForEach-Object {
  $out = ($_ -replace "^\s+$", "").TrimEnd()
  if ($out) { Write-Log "  $out" }
}
if ($LASTEXITCODE -ne 0) {
  Write-Log "ERROR: build failed (exit=$LASTEXITCODE)"
  exit 3
}

# 4) Deploy
if ($SkipDeploy) {
  Write-Log "SkipDeploy=true, skip push"
} else {
  Write-Log "run npm run deploy ..."
  & npm.cmd run deploy 2>&1 | ForEach-Object {
    $out = ($_ -replace "^\s+$", "").TrimEnd()
    if ($out) { Write-Log "  $out" }
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: deploy failed (exit=$LASTEXITCODE)"
    exit 4
  }
}

Write-Log "==== done ===="
