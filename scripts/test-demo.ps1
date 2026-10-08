[CmdletBinding()]
param(
  [switch]$FullJourney
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
Set-Location $projectRoot

function Assert-That([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "CHECK FAILED: $Message" }
  Write-Host "PASS: $Message" -ForegroundColor Green
}
function Get-EnvValue([string]$Name) {
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if ($line) { return $line.Substring($Name.Length + 1) }
  return ''
}
function Invoke-Json([string]$Method, [string]$Path, [object]$Body, $Session = $null) {
  $options = @{ Method = $Method; Uri = "http://localhost:3000$Path"; ContentType = 'application/json'; ErrorAction = 'Stop' }
  if ($null -ne $Body) { $options.Body = $Body | ConvertTo-Json -Depth 8 -Compress }
  if ($null -ne $Session) { $options.WebSession = $Session }
  return Invoke-RestMethod @options
}

if (-not (Test-Path $envFile)) { throw 'Missing .env. Run scripts\start-demo.ps1 first.' }

Write-Host 'Running repository checks…' -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm audit --omit=dev --audit-level=critical
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`nRunning live API checks…" -ForegroundColor Cyan
$ready = Invoke-RestMethod -Uri 'http://localhost:3000/readyz' -ErrorAction Stop
Assert-That ($ready.ok -eq $true) 'API readiness endpoint is healthy'
$config = Invoke-Json 'GET' '/api/config/public' $null
Assert-That ($null -ne $config.event.name) 'Public event configuration is readable'
$categories = Invoke-Json 'GET' '/api/categories' $null
Assert-That ($categories.Count -ge 3) 'At least three seeded award categories are available'
Assert-That ($categories[0].exhibitors.Count -gt 0) 'Seeded exhibitors are available'
$qr = Invoke-Json 'GET' '/api/display/qr' $null
Assert-That ($qr.url -match '/p/v1\.') 'QR API returns a signed rotating presence URL'

if ($FullJourney) {
  Assert-That ($config.accessMode -eq 'OFF') 'Full local test starts only with development access mode OFF'
  $suffix = (Get-Random -Minimum 1000000 -Maximum 9999999).ToString('D7')
  $phone = "079$suffix"
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $otp = Invoke-Json 'POST' '/api/auth/otp/request' @{ name = "Demo Test $suffix"; phone = $phone; consent = $true } $session
  Assert-That ($null -ne $otp.challengeId) 'OTP challenge created'
  $code = Get-EnvValue 'DEMO_OTP_CODE'
  Assert-That ($code -match '^\d{6}$') 'Demo OTP configuration is present'
  $verified = Invoke-Json 'POST' '/api/auth/otp/verify' @{ challengeId = $otp.challengeId; code = $code } $session
  Assert-That ($verified.ok -eq $true) 'OTP verification issued a visitor session'
  $me = Invoke-Json 'GET' '/api/me' $null $session
  Assert-That ($me.visitor.phoneLast4 -eq $phone.Substring($phone.Length - 4)) 'Visitor session identifies the masked phone'
  foreach ($category in $categories) {
    $vote = Invoke-Json 'POST' '/api/votes' @{ categoryId = $category.id; exhibitorId = $category.exhibitors[0].id } $session
    Assert-That ($vote.status -eq 'RECORDED') "Vote recorded for $($category.nameEn)"
  }
  $meAfter = Invoke-Json 'GET' '/api/me' $null $session
  Assert-That ($meAfter.castVotes.Count -eq 3) 'Visitor has exactly three category votes'
}

Write-Host "`nAll requested demo checks passed." -ForegroundColor Green
