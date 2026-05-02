param(
  [string]$ProjectId,
  [switch]$HostingOnly,
  [switch]$RulesOnly
)

$ErrorActionPreference = "Stop"

if ($HostingOnly -and $RulesOnly) {
  Write-Error "Use only one option: -HostingOnly or -RulesOnly."
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error "npx is not available. Install Node.js so npx can run firebase-tools."
}

Write-Host "Starting deploy for nORDER..." -ForegroundColor Cyan

$firebasercPath = Join-Path $PSScriptRoot ".firebaserc"
if ((-not $ProjectId) -and (Test-Path $firebasercPath)) {
  $firebasercRaw = Get-Content -Path $firebasercPath -Raw
  if ($firebasercRaw -match "REPLACE_WITH_NEW_FIREBASE_PROJECT_ID") {
    Write-Error "No project selected. Set .firebaserc default project or pass -ProjectId <your-project-id>."
  }
}

$deployArgs = @("deploy")
if ($HostingOnly) {
  Write-Host "Deploy target: Hosting only" -ForegroundColor Yellow
  $deployArgs += @("--only", "hosting")
} elseif ($RulesOnly) {
  Write-Host "Deploy target: Realtime Database rules only" -ForegroundColor Yellow
  $deployArgs += @("--only", "database")
} else {
  Write-Host "Deploy target: Hosting + Database rules" -ForegroundColor Yellow
}

if ($ProjectId) {
  Write-Host "Project override: $ProjectId" -ForegroundColor Yellow
  $deployArgs += @("--project", $ProjectId)
}

Write-Host "Checking Firebase CLI (npx -y firebase-tools@latest)..." -ForegroundColor DarkGray
$previousNodeOptions = $env:NODE_OPTIONS
$temporaryNodeOptions = "--no-deprecation"
if ([string]::IsNullOrWhiteSpace($previousNodeOptions)) {
  $env:NODE_OPTIONS = $temporaryNodeOptions
} elseif ($previousNodeOptions -notmatch "--no-deprecation") {
  $env:NODE_OPTIONS = "$previousNodeOptions $temporaryNodeOptions"
}

try {
  & npx -y firebase-tools@latest --version | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not run firebase-tools through npx."
  }

  & npx -y firebase-tools@latest @deployArgs
} finally {
  if ($null -eq $previousNodeOptions) {
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  } else {
    $env:NODE_OPTIONS = $previousNodeOptions
  }
}

if ($LASTEXITCODE -ne 0) {
  Write-Error "Deploy failed."
}

Write-Host "Deploy completed." -ForegroundColor Green
