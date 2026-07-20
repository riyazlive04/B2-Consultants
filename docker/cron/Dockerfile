# Cron driver for the B2 app.
#
# The app has NO internal clock — four routes under /api/cron/* do real work and
# something external must tick them. On Windows that was scripts/install-cron-task.ps1
# (Task Scheduler); on the VPS that mechanism does not exist, so this tiny sidecar
# takes over. It talks to the app over the private compose network (http://app:3000),
# so the ticks never traverse Caddy, never touch the public internet, and never need TLS.

FROM alpine:3.20
# busybox already provides crond; we only need curl and real timezone data.
RUN apk add --no-cache curl tzdata

COPY docker/cron/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/cron/tick.sh /usr/local/bin/tick.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/tick.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
