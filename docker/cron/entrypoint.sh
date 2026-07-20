#!/bin/sh
set -eu

# crond does NOT inherit the container's environment — jobs run under a bare
# environment, so CRON_SECRET would be empty if the crontab referenced it directly.
# The standard fix: snapshot the env we need to a file now, and have each job source
# it. 0600 + root-owned; the secret never lands in the crontab (which is world-readable
# via `crontab -l`) and never appears in a process argument list (visible in `ps`).
umask 077
cat > /etc/cron.env <<EOF
CRON_SECRET='${CRON_SECRET:-}'
APP_URL='${APP_URL:-http://app:3000}'
EOF
chmod 600 /etc/cron.env

if [ -z "${CRON_SECRET:-}" ]; then
  # Fail loudly rather than tick uselessly for weeks. The routes themselves answer
  # 503 "Cron not configured" when the secret is unset, so a silent start here would
  # look healthy while every automation quietly did nothing.
  echo "FATAL: CRON_SECRET is not set — the app's cron routes would reject every tick (503)." >&2
  exit 1
fi

# Cadences come from the route files' own CADENCE comments:
#   outreach   — every minute   (tightest; the SOP ladder has a 5-minute SLA)
#   workflows  — every 5 min    (automation enrollments due-check)
#   whatsapp   — every 15 min   (also drives booking confirmations)
#   daily-log  — every 15 min   (idempotent EOD auto-save; no-op before the cutoff)
#   retention  — once a day      (purge archived records past the 90-day window; idempotent)
#   daily      — hourly          (FX prewarm, OVERDUE sweep, invoice-issuance backfill, growth-table
#                                 retention once/day, scheduled digest; every sub-job idempotent +
#                                 flag-gated. Separate from `retention` above, which purges archives.)
cat > /etc/crontabs/root <<'EOF'
* * * * * /usr/local/bin/tick.sh outreach
*/5 * * * * /usr/local/bin/tick.sh workflows
*/15 * * * * /usr/local/bin/tick.sh whatsapp
*/15 * * * * /usr/local/bin/tick.sh daily-log
0 3 * * * /usr/local/bin/tick.sh retention
0 * * * * /usr/local/bin/tick.sh daily
EOF
chmod 600 /etc/crontabs/root

echo "cron: TZ=${TZ:-UTC} target=${APP_URL:-http://app:3000} — outreach 1m, workflows 5m, whatsapp/daily-log 15m, retention daily, daily 1h"

# -f foreground (PID 1), -d 8 logs each job to stderr so `docker compose logs cron` works.
exec crond -f -d 8
