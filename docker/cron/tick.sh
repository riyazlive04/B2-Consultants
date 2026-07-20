#!/bin/sh
set -eu

# One cron tick. Usage: tick.sh <route>   e.g. tick.sh outreach
. /etc/cron.env

ROUTE="$1"
URL="${APP_URL}/api/cron/${ROUTE}"

# The secret goes in a header, never in the URL. The routes accept `?key=` too, but a
# query string would be written to the app's access log in plaintext on every tick.
#
# --max-time 120: the outreach tick fires every 60s; without a ceiling a wedged request
# would pile up overlapping curls until the container runs out of file descriptors.
# No retry: each route is idempotent and re-ticks on the next schedule anyway, so a
# retry here would only double the load during an incident.
CODE=$(curl -s -o /tmp/tick.out -w '%{http_code}' \
  --max-time 120 \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "$URL" || echo "000")

if [ "$CODE" = "200" ]; then
  # Quiet on success — the outreach route alone would otherwise emit 1,440 lines/day.
  exit 0
fi

# 000 = curl could not connect at all (app still booting, or down).
echo "cron ${ROUTE}: HTTP ${CODE} $(head -c 200 /tmp/tick.out 2>/dev/null || true)" >&2
exit 1
