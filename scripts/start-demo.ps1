[CmdletBinding()]
param(
  [switch]$Lan,
  [switch]$LocalOnly,
  [switch]$OpenDisplays,
  [switch]$UseDocker
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$demoDirectory = Join-Path $projectRoot '.demo'
$envFile = Join-Path $projectRoot '.env'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Fail([string]$Message) { Write-Host "`nERROR: $Message" -ForegroundColor Red; exit 1 }
function Wait-ForUrl([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { Invoke-WebRequest -Uri $Url -TimeoutSec 2 | Out-Null; return } catch { Start-Sleep -Milliseconds 600 }
  } while ((Get-Date) -lt $deadline)
  Fail "Timed out waiting for $Url. Check .demo/api-error.log and .demo/web-error.log."
}
function Set-EnvValue([string]$Name, [string]$Value) {
  $escaped = [regex]::Escape($Name)
  $lines = Get-Content -LiteralPath $envFile
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^$escaped=") { $found = $true; "$Name=$Value" } else { $line }
  }
  if (-not $found) { $updated += "$Name=$Value" }
  Set-Content -LiteralPath $envFile -Value $updated -Encoding utf8
}
function Get-EnvValue([string]$Name) {
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if ($line) { return $line.Substring($Name.Length + 1) }
  return ''
}

Set-Location $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 20+ is required. Install it from https://nodejs.org/.' }
$nodeVersion = (node --version)
if ([int]([regex]::Match($nodeVersion, '\d+').Value) -lt 20) { Fail "Node.js 20+ is required; found $nodeVersion." }
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $projectRoot '.env.example') $envFile; Write-Host 'Created .env from .env.example.' -ForegroundColor Yellow }

# A judge demo is phone-ready by default. Use -LocalOnly only when no phone scans the QR.
$enableLan = -not $LocalOnly
if ($Lan) { $enableLan = $true }
if ($enableLan) {
  $lanConfig = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    Select-Object -First 1
  $lanIp = $lanConfig.IPv4Address |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.AddressState -eq 'Preferred' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $lanIp) { Fail 'Could not find a LAN IPv4 address. Connect to Wi-Fi/Ethernet, or update PUBLIC_BASE_URL in .env manually.' }
  Set-EnvValue 'PUBLIC_BASE_URL' "http://$lanIp`:5173"
  Write-Host "Phone/QR address: http://$lanIp`:5173" -ForegroundColor Green
  $firewallRule = Get-NetFirewallRule -DisplayName 'MC2026 Demo Web (LAN)' -ErrorAction SilentlyContinue
  if (-not $firewallRule) {
    try {
      New-NetFirewallRule -DisplayName 'MC2026 Demo Web (LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet -Profile Any -ErrorAction Stop | Out-Null
      Write-Host 'Enabled phone access to the web app from this local subnet.' -ForegroundColor Green
    } catch {
      Write-Host 'Windows Firewall may block phone access. In an Administrator PowerShell, run:' -ForegroundColor Yellow
      Write-Host "New-NetFirewallRule -DisplayName 'MC2026 Demo Web (LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet -Profile Any"
    }
  }
} else {
  Set-EnvValue 'PUBLIC_BASE_URL' 'http://localhost:5173'
}

if ($UseDocker) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker was not found. Start PostgreSQL locally, or install/enable Docker Desktop.' }
  $postgresPort = docker compose port postgres 5432 2>$null
  if ((Get-NetTCPConnection -State Listen -LocalPort 5433 -ErrorAction SilentlyContinue) -and $postgresPort -notmatch ':5433$') { Fail 'Port 5433 is already in use. Free it, or start PostgreSQL locally and omit -UseDocker.' }
  $databaseUrl = Get-EnvValue 'DATABASE_URL'
  $databaseUrl = $databaseUrl -replace '(localhost|127\.0\.0\.1):5432(?=/)', '$1:5433'
  Set-EnvValue 'DATABASE_URL' $databaseUrl
  Write-Step 'Starting the demo PostgreSQL container'
  docker compose up -d postgres
  if ($LASTEXITCODE -ne 0) { Fail 'Could not start the demo PostgreSQL container.' }
} else {
  $databaseUrl = Get-EnvValue 'DATABASE_URL'
  $databaseUrl = $databaseUrl -replace '(localhost|127\.0\.0\.1):5433(?=/)', '$1:5432'
  Set-EnvValue 'DATABASE_URL' $databaseUrl
  $postgresReady = Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $postgresReady) { Fail 'PostgreSQL is not reachable on localhost:5432. Start it, or run this script with -UseDocker.' }
}

New-Item -ItemType Directory -Force -Path $demoDirectory | Out-Null
foreach ($name in @('api.pid', 'web.pid')) {
  $pidFile = Join-Path $demoDirectory $name
  if (Test-Path $pidFile) {
    $oldId = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldId -and (Get-Process -Id $oldId -ErrorAction SilentlyContinue)) { Fail "A previous demo is still running. Run .\scripts\stop-demo.ps1 first." }
    Remove-Item -LiteralPath $pidFile -Force
  }
}

if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
  Write-Step 'Installing npm dependencies'
  npm install
}

Write-Step 'Applying database schema and demo seed'
npm run db:migrate
if ($LASTEXITCODE -ne 0) { Fail 'Database migration failed; see the error above.' }
npm run db:seed
if ($LASTEXITCODE -ne 0) { Fail 'Demo database seeding failed; see the error above.' }

Write-Step 'Starting API and web app'
$api = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '-w', '@mc2026/api') -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $demoDirectory 'api.log') -RedirectStandardError (Join-Path $demoDirectory 'api-error.log') -PassThru -WindowStyle Hidden
$web = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '-w', '@mc2026/web', '--', '--host', '0.0.0.0') -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $demoDirectory 'web.log') -RedirectStandardError (Join-Path $demoDirectory 'web-error.log') -PassThru -WindowStyle Hidden
$api.Id | Set-Content (Join-Path $demoDirectory 'api.pid')
$web.Id | Set-Content (Join-Path $demoDirectory 'web.pid')

Wait-ForUrl 'http://127.0.0.1:3000/readyz' 90
Wait-ForUrl 'http://127.0.0.1:5173' 90

$publicBaseUrl = Get-EnvValue 'PUBLIC_BASE_URL'
if ($enableLan) { Wait-ForUrl "$publicBaseUrl/" 30 }
$qrPayload = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/display/qr' -TimeoutSec 10
if ($qrPayload.url -notlike "$publicBaseUrl/p/v1.*") { Fail "The QR URL does not point at this demo host: $($qrPayload.url)" }
$qrPayload.url | Set-Content -LiteralPath (Join-Path $demoDirectory 'current-qr-url.txt') -Encoding utf8

$adminUser = Get-EnvValue 'DEMO_ADMIN_USERNAME'
$adminPassword = Get-EnvValue 'DEMO_ADMIN_PASSWORD'
Write-Host "`nDemo is ready." -ForegroundColor Green
Write-Host "Admin:    http://localhost:5173/admin"
Write-Host "Visitor:  $publicBaseUrl/"
Write-Host "QR TV:    http://localhost:5173/display/qr"
Write-Host "Results:  http://localhost:5173/display/results"
Write-Host "QR target: $($qrPayload.url)" -ForegroundColor Green
Write-Host "`nAdmin login: $adminUser / $adminPassword" -ForegroundColor Yellow
Write-Host 'Open the QR TV page on the laptop, then scan the visible QR from a phone on the same Wi-Fi.' -ForegroundColor Yellow
Write-Host 'The exact active QR target is saved in .demo\current-qr-url.txt.' -ForegroundColor Yellow

Start-Process 'http://localhost:5173/admin'
if ($OpenDisplays) {
  Start-Process 'http://localhost:5173/display/qr'
  Start-Process 'http://localhost:5173/display/results'
}
