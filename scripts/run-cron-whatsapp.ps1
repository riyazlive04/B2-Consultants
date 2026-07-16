# B2 — WhatsApp reminder tick.
#
# The app has no clock of its own: `automation-queue.ts` says it outright — "Nothing here can
# wake itself up without an HTTP request landing on this process." BullMQ has a Queue but no
# Worker. So this script IS the scheduler: Windows Task Scheduler runs it, it pokes the
# endpoint, the endpoint runs the due reminders.
#
# The secret is read from .env at run time and sent as a header — never baked into the task
# definition, never echoed, so it can't leak into Task Scheduler's UI or the log below.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\run-cron-whatsapp.ps1
# Register it with scripts\install-cron-task.ps1.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$logFile = Join-Path $root "cron-whatsapp.log"

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

$uri = "$baseUrl/api/cron/whatsapp"
try {
  $res = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ "x-cron-secret" = $secret } -TimeoutSec 120
  $run = $res.run
  if ($run.enabled -eq $false) {
    Write-Log ("ok    reminders disabled: {0}" -f $run.reason)
  } else {
    # perKind is an object; render it compactly so the log stays greppable.
    $kinds = ($run.perKind.PSObject.Properties | ForEach-Object {
      "{0}=s{1}/k{2}/f{3}" -f $_.Name, $_.Value.sent, $_.Value.skipped, $_.Value.failed
    }) -join " "
    Write-Log ("ok    sent={0} skipped={1} failed={2}  {3}" -f $run.total.sent, $run.total.skipped, $run.total.failed, $kinds)
  }
} catch {
  # A stopped dev server is the normal case on a laptop — log it and move on, never throw.
  Write-Log ("FAIL  {0}" -f $_.Exception.Message)
  exit 1
}
