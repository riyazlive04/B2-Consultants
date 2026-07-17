# B2 — daily-log EOD tick.
#
# The app has no clock of its own. The CUTOFF doesn't need one (submitDailyLog reads the real
# clock, so the deadline holds regardless), but AUTO-SAVE does: without this tick, a member who
# never logs simply has no row, and "every log is saved by EOD" quietly isn't true.
#
# Safe to run as often as you like: the endpoint no-ops before the founder's cutoff and is
# idempotent after it (one row per person per day, enforced by a unique index).
#
# The secret is read from .env at run time and sent as a header — never baked into the task
# definition, never echoed, so it can't leak into Task Scheduler's UI or the log below.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\run-cron-daily-log.ps1
# Register it with scripts\install-daily-log-task.ps1.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$logFile = Join-Path $root "cron-daily-log.log"

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

$uri = "$baseUrl/api/cron/daily-log"
try {
  $res = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ "x-cron-secret" = $secret } -TimeoutSec 120
  $run = $res.run
  if (-not $run.enabled) {
    Write-Log ("ok    {0}" -f $run.reason)
  } elseif ($run.reason) {
    Write-Log ("ok    {0}" -f $run.reason)
  } else {
    $who = if ($run.autoSavedMembers) { ($run.autoSavedMembers | ForEach-Object { $_.name }) -join "," } else { "-" }
    Write-Log ("ok    date={0} autoSaved={1} alreadyLogged={2}  {3}" -f $run.date, $run.autoSaved, $run.alreadyLogged, $who)
  }
} catch {
  # A stopped dev server is the normal case on a laptop — log it and move on, never throw.
  Write-Log ("FAIL  {0}" -f $_.Exception.Message)
  exit 1
}
