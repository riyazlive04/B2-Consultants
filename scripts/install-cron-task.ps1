# Registers the Windows Scheduled Task that gives B2 a clock.
#
# WHY THIS EXISTS: the app cannot wake itself up. `automation-queue.ts:26` — "Nothing here can
# wake itself up without an HTTP request landing on this process." BullMQ has a Queue but no
# Worker, and there is no `worker` script. Without an external tick, EMI reminders never fire.
#
# ⚠ BLAST RADIUS — READ BEFORE RUNNING ⚠
# This tick runs runDueReminders(), which walks EVERY WhatsApp touchpoint, not just EMI.
# Only the EMI pre-due reminder has a dry-run switch; the rest send for real. A touchpoint can
# only fire if a WATI template is mapped to it (hasTemplate gate), so the mapped set IS the
# blast radius. At the time of writing that set is:
#     EMI_PRE_DUE -> dry run (logs only)
#     MANUAL      -> not part of the scheduled cadence
# i.e. this task currently sends NOTHING. But the moment someone maps a template for
# PAYMENT_REMINDER / DISCO_REMINDER / BOOKING_REMINDER / CHECKIN_NUDGE, this task will start
# sending those for real, every 15 minutes, to whatever numbers are in the database —
# including seeded demo students. Check WhatsApp → Settings → templates before mapping any.
#
# Run as: normal user (no admin needed for a user-scoped task).
#   powershell -ExecutionPolicy Bypass -File scripts\install-cron-task.ps1
# Remove with:
#   Unregister-ScheduledTask -TaskName "B2 WhatsApp reminders" -Confirm:$false

$ErrorActionPreference = "Stop"

$taskName = "B2 WhatsApp reminders"
$root     = Split-Path -Parent $PSScriptRoot
$script   = Join-Path $root "scripts\run-cron-whatsapp.ps1"

if (-not (Test-Path $script)) { throw "Missing $script" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# Every 15 minutes, indefinitely, starting now. 15 min matches the endpoint's documented
# cadence (~15 min). Note: the outreach SOP needs a 1-MINUTE tick to police its 5-minute SLA —
# that is a different endpoint (/api/cron/outreach) and a separate task.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
  -RepetitionDuration ([TimeSpan]::MaxValue)

# Laptop-friendly: don't demand AC power, don't stop when the battery kicks in, and don't
# queue a pile-up of missed runs — a reminder tick is worthless once it's stale.
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
  -Description "Ticks B2's /api/cron/whatsapp every 15 min so scheduled reminders (incl. pre-due EMI) actually fire. The app has no internal scheduler." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $taskName"
Write-Host "  runs   : every 15 minutes while you are logged in"
Write-Host "  script : $script"
Write-Host "  log    : $(Join-Path $root 'cron-whatsapp.log')"
Write-Host ""
Write-Host "Run it once now with:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Remove it with:        Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
