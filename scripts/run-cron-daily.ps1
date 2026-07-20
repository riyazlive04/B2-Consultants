# B2 — daily-maintenance tick.
#
# The app has no clock of its own (see automation-queue.ts). This script IS the scheduler for the
# once-a-day housekeeping: Windows Task Scheduler runs it hourly, it pokes /api/cron/daily, and the
# endpoint runs FX prewarm, the OVERDUE sweep, invoice-issuance backfill, the growth-table retention
# sweep (once/day) and the scheduled founder digest. Every sub-job is idempotent and flag-gated, so
# an hourly tick is safe and most ticks are near-no-ops.
#
# The secret is read from .env at run time and sent as a header — never baked into the task
# definition, never echoed, so it can't leak into Task Scheduler's UI or the log below.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\run-cron-daily.ps1
# Register it with scripts\install-daily-task.ps1.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$logFile = Join-Path $root "cron-daily.log"

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

if (-not (Test-Path $envFile)) { Write-Log "SKIP: no .env at $envFile"; exit 1 }

# Pull CRON_SECRET + the app's base URL out of .env without printing either.
$secret = $null
$baseUrl = "http://localhost:3000"
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*CRON_SECRET\s*=\s*"?([^"#\r\n]+)"?') { $secret = $Matches[1].Trim() }
  if ($line -match '^\s*BETTER_AUTH_URL\s*=\s*"?([^"#\r\n]+)"?') { $baseUrl = $Matches[1].Trim().TrimEnd('/') }
}
if (-not $secret) { Write-Log "SKIP: CRON_SECRET not set in .env (endpoint would 503 anyway)"; exit 1 }

$uri = "$baseUrl/api/cron/daily"
try {
  $res = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ "x-cron-secret" = $secret } -TimeoutSec 120
  # Render the per-job summary compactly so the log stays greppable.
  $jobs = ($res.run.jobs.PSObject.Properties | ForEach-Object { $_.Name }) -join ","
  Write-Log ("ok    ran={0}" -f $jobs)
} catch {
  # A stopped dev server is the normal case on a laptop — log it and move on, never throw.
  Write-Log ("FAIL  {0}" -f $_.Exception.Message)
  exit 1
}
