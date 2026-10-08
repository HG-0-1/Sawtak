$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$demoDirectory = Join-Path $projectRoot '.demo'
foreach ($name in @('api.pid', 'web.pid')) {
  $pidFile = Join-Path $demoDirectory $name
  if (Test-Path $pidFile) {
    $processId = Get-Content $pidFile -ErrorAction SilentlyContinue
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -Id $processId -Force; Write-Host "Stopped $name ($processId)." }
    Remove-Item -LiteralPath $pidFile -Force
  }
}
Write-Host 'The MC2026 API and web development processes have been stopped.'
