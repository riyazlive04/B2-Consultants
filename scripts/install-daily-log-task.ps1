# Registers the Windows Scheduled Task that gives the daily-log EOD job a clock.
#
# WHY THIS EXISTS: the app cannot wake itself up. The EOD cutoff itself does NOT need this —
# submitDailyLog reads the real clock, so the deadline is enforced with or without a scheduler.
# What needs it is AUTO-SAVE: nothing writes a row for a member who never logged unless an HTTP
# request lands on /api/cron/daily-log after the cutoff.
#
# BLAST RADIUS — small, and worth knowing exactly:
# This tick calls runDailyLogEod(), which writes DailyLog rows (source=EOD_AUTO) for ACTIVE,
# non-Admin team members who have no log for today. It sends NOTHING — no WhatsApp, no email.
# It is gated three ways and no-ops unless ALL hold:
#     Console → Daily Targets → "Enforce end-of-day rules"  = ON
#     Console → Daily Targets → "Auto-save at cutoff"       = ON
#     the IST clock is past the configured cutoff
# Those rows feed the Telecaller Pay board, so they are stamped EOD_AUTO and stay amendable by
# their owner — see the amend-window setting in the same panel.
#
# Every 15 min rather than once at the cutoff ON PURPOSE: a laptop asleep at exactly 9:00 PM
# would miss a once-a-day trigger entirely and the day would stay blank. The job is idempotent,
# so re-ticking costs nothing.
#
# Run as: normal user (no admin needed for a user-scoped task).
#   powershell -ExecutionPolicy Bypass -File scripts\install-daily-log-task.ps1
# Remove with:
#   Unregister-ScheduledTask -TaskName "B2 daily-log EOD" -Confirm:$false

$ErrorActionPreference = "Stop"

$taskName = "B2 daily-log EOD"
$root     = Split-Path -Parent $PSScriptRoot
$script   = Join-Path $root "scripts\run-cron-daily-log.ps1"

if (-not (Test-Path $script)) { throw "Missing $script" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# NB: -RepetitionDuration ([TimeSpan]::MaxValue) is what the older install-cron-task.ps1 uses,
# and Task Scheduler REJECTS it on this machine ("value ... incorrectly formatted or out of
# range" — it serialises to P99999999DT23H59M59S). A long finite duration registers cleanly and
# is indistinguishable in practice.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

# Laptop-friendly: don't demand AC power, don't stop when the battery kicks in, and do catch up
# a missed run — unlike the WhatsApp tick, a late EOD save is still correct and still wanted.
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
  -Description "Ticks B2's /api/cron/daily-log every 15 min so the EOD job auto-saves a log for anyone who didn't submit. The app has no internal scheduler. No-ops unless EOD rules + auto-save are ON and the cutoff has passed." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $taskName"
Write-Host "  runs   : every 15 minutes while you are logged in"
Write-Host "  script : $script"
Write-Host "  log    : $(Join-Path $root 'cron-daily-log.log')"
Write-Host ""
Write-Host "Run it once now with:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Remove it with:        Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
