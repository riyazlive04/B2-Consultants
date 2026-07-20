# Registers the Windows Scheduled Task that ticks B2's daily-maintenance route.
#
# WHY THIS EXISTS: the app cannot wake itself up (automation-queue.ts: "Nothing here can wake itself
# up without an HTTP request landing on this process."). Without an external tick the FX rate is
# never pre-warmed, invoices/instalments never flip to OVERDUE, the growth-table retention sweep
# never runs, and the scheduled founder digest never sends. The Docker prod stack ticks this via its
# cron sidecar; on a Windows/laptop deployment this task is the equivalent.
#
# SAFE BY DEFAULT: every job behind /api/cron/daily is idempotent and flag-gated. Retention (which
# deletes) ships OFF; FX prewarm and the OVERDUE sweep ship ON but are non-destructive. Nothing here
# sends WhatsApp or moves money.
#
# Run as: normal user (no admin needed for a user-scoped task).
#   powershell -ExecutionPolicy Bypass -File scripts\install-daily-task.ps1
# Remove with:
#   Unregister-ScheduledTask -TaskName "B2 daily maintenance" -Confirm:$false

$ErrorActionPreference = "Stop"

$taskName = "B2 daily maintenance"
$root     = Split-Path -Parent $PSScriptRoot
$script   = Join-Path $root "scripts\run-cron-daily.ps1"

if (-not (Test-Path $script)) { throw "Missing $script" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# Every hour, indefinitely, starting now. The route's own CADENCE comment documents hourly: the
# once-per-day guards inside keep the destructive work to a single run, while an hourly cadence lets
# the scheduled digest fire close to its configured IST send time.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration ([TimeSpan]::MaxValue)

# Laptop-friendly: don't demand AC power, don't stop on battery, and don't pile up missed runs.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Ticks B2's /api/cron/daily every hour so FX prewarm, the OVERDUE sweep, invoice-issuance backfill, the retention sweep and the scheduled digest actually run. The app has no internal scheduler." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $taskName"
Write-Host "  runs   : every hour while you are logged in"
Write-Host "  script : $script"
Write-Host "  log    : $(Join-Path $root 'cron-daily.log')"
Write-Host ""
Write-Host "Run it once now with:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Remove it with:        Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
