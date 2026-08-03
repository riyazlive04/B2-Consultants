# Scheduled wrapper for scripts/backup-verify.mjs.
#
# Same shape as run-cron-daily.ps1 — a Task Scheduler entry points here, this loads the project's
# .env and runs the backup, and the transcript lands next to the app so a failure is diagnosable
# after the fact rather than only while you are watching.
#
# Register it (once, elevated):
#   schtasks /Create /TN "B2 backup verify" /SC DAILY /ST 02:30 ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\path\to\scripts\run-backup-verify.ps1"
#
# The scratch restore target must be reachable — start the local instance first
# (`npm run db:local`) or point BACKUP_SCRATCH_URL at a database that is always up.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $root "backup-verify.log"

Set-Location $root

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $log -Value "`n===== $stamp =====" -Encoding utf8

# --env-file is Node's own loader; no dotenv dependency, and it matches how the other
# scripts in this folder are invoked.
$output = & node --env-file=.env scripts/backup-verify.mjs 2>&1
$code = $LASTEXITCODE

Add-Content -Path $log -Value $output -Encoding utf8
Add-Content -Path $log -Value "exit=$code" -Encoding utf8

if ($code -ne 0) {
  # Surfaces in Task Scheduler's "Last Run Result" column, which is the only place anyone
  # looks without being told to. A backup that fails silently is the failure mode this whole
  # script exists to prevent, so the wrapper must not swallow it either.
  Write-Error "Backup verification FAILED (exit $code). See $log"
  exit $code
}

exit 0
