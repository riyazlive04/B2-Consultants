#!/usr/bin/env bash
#
# B2 Consultants — nightly backup of the self-hosted Postgres, ON the VPS.
#
# Installed at /usr/local/bin/b2-backup.sh and driven by b2-backup.timer.
# Source of truth is deploy/vps/ in the repo; edit there, not here.
#
# ─────────────────────────── WHY IT IS SHAPED THIS WAY ───────────────────────────
#
# "Backups are enabled" is not a backup (docs/OPERABILITY_PLAN.md). So this script does not
# merely write a file and exit 0 — it RESTORES the file into a scratch database and COUNTS the
# rows. A dump that cannot be restored is indistinguishable from a successful backup right up
# until the day you need it, and that is the whole failure mode worth engineering against.
#
# WHY `docker exec` AND NOT HOST pg_dump:
#   The host has no PostgreSQL client tools, and installing them would create a second version to
#   keep in step with the server. `supabase-db` already contains pg_dump/pg_restore/psql at
#   EXACTLY the server's version (17.6). A version-matched dump is one less thing to be wrong.
#
# WHY `--schema=public`:
#   The same reason the migration needs it (docs/SELFHOSTED_SUPABASE_MIGRATION.md §3a). The app
#   lives entirely in `public`, including Better Auth. The `auth`/`storage`/`realtime`/
#   `supabase_migrations` schemas belong to the Supabase stack and are recreated by it on a fresh
#   install — restoring one install's copy into another is how you get a stack that will not boot.
#   A disaster recovery is therefore: bring the stack up clean, then restore public into it.
#
# ⚠ WHERE THESE LIVE, AND THE LIMIT OF THAT:
#   /root/b2-backups, on the SAME DISK as the database, as requested. This protects against the
#   failures that actually happen most — a bad migration, a wrong DELETE, a dropped table. It does
#   NOT protect against losing the box or the disk, because the only copy dies with it. Getting a
#   copy off the machine is the single highest-value thing left to do here.

set -Eeuo pipefail

CONTAINER=supabase-db
DB=postgres
DB_USER=postgres
OUT_DIR=/root/b2-backups
RETENTION_DAYS=30
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DUMP="$OUT_DIR/b2-$STAMP.dump"
STATUS="$OUT_DIR/.last-status"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"   # dumps hold PII, home addresses and IBANs

# Record the outcome whatever happens, so a human (or a future check) can tell when this last
# actually worked rather than when it last ran.
finish() {
  local code=$?
  if [ $code -eq 0 ]; then
    printf 'ok %s\n' "$STAMP" > "$STATUS"
  else
    printf 'FAILED %s (exit %d)\n' "$STAMP" "$code" > "$STATUS"
    echo "b2-backup FAILED at stage: ${STAGE:-unknown} (exit $code)" >&2
  fi
  # Never leave a scratch database behind, even on a crash — it would be restored into again
  # next run and the "is it empty" logic would be meaningless.
  if [ -n "${SCRATCH:-}" ]; then
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -qtAc \
      "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
  fi
  exit $code
}
trap finish EXIT

q() { docker exec "$CONTAINER" psql -U "$DB_USER" -d "$1" -qtAX -v ON_ERROR_STOP=1 -c "$2"; }

# Counts every row in every public table. Deliberately NOT pg_class.reltuples, which is the fast
# answer and an ESTIMATE maintained by autovacuum — it can read plausibly while being wrong, which
# is the one thing a verification step must never do.
COUNT_SQL="
SELECT coalesce(sum(cnt),0) FROM (
  SELECT (xpath('/row/c/text()',
           query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                        false, true, '')))[1]::text::bigint AS cnt
  FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
) s;"

STAGE=preflight
docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null | grep -qx healthy \
  || { echo "$CONTAINER is not healthy; refusing to back up" >&2; exit 1; }

STAGE=dump
LIVE_ROWS=$(q "$DB" "$COUNT_SQL" | tr -d '[:space:]')
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB" \
  --schema=public --format=custom --no-owner --no-privileges --compress=9 > "$DUMP"
chmod 600 "$DUMP"
BYTES=$(stat -c %s "$DUMP")
[ "$BYTES" -gt 10240 ] || { echo "dump is implausibly small ($BYTES bytes)" >&2; exit 1; }

STAGE=restore-verify
SCRATCH="b2_verify_$(date -u +%s)"
q "$DB" "CREATE DATABASE \"$SCRATCH\";" >/dev/null
# DROP the scratch database's own `public` before restoring into it.
#
# A `--schema=public` dump carries `CREATE SCHEMA public`, and every new database already has one
# (inherited from template1), so the restore dies on:
#     ERROR: schema "public" already exists
# Under --single-transaction that aborts the whole restore, so the verification fails even though
# the dump is perfectly good. Removing the schema first lets the dump recreate it exactly as it
# was captured, which is also a truer test: the restore builds `public` from scratch, the way a
# real disaster recovery into a fresh stack would.
q "$SCRATCH" "DROP SCHEMA IF EXISTS public CASCADE;" >/dev/null
# --single-transaction so a partial restore cannot be mistaken for a good one.
# The dump has to go back IN through the container, hence the pipe rather than a path.
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$SCRATCH" \
  --no-owner --no-privileges --single-transaction < "$DUMP" >/dev/null
RESTORED_ROWS=$(q "$SCRATCH" "$COUNT_SQL" | tr -d '[:space:]')

if [ "$LIVE_ROWS" != "$RESTORED_ROWS" ]; then
  echo "row count mismatch: live=$LIVE_ROWS restored=$RESTORED_ROWS" >&2
  exit 1
fi

STAGE=prune
# -mtime +N is "older than N days", so +30 keeps today plus 30 days of history.
PRUNED=$(find "$OUT_DIR" -maxdepth 1 -name 'b2-*.dump' -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
KEPT=$(find "$OUT_DIR" -maxdepth 1 -name 'b2-*.dump' -type f | wc -l)

STAGE=done
printf 'b2-backup ok: %s (%s bytes, %s rows verified) · pruned %s · retained %s (%s-day policy)\n' \
  "$(basename "$DUMP")" "$BYTES" "$RESTORED_ROWS" "$PRUNED" "$KEPT" "$RETENTION_DAYS"
