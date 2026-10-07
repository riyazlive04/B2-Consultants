# Serve the app LOCALLY for a human to click through.
#
# ── Why dev mode and not a production build ───────────────────────────────────────
# `next start` forces NODE_ENV=production, and `lib/env.ts` deliberately refuses to boot when
# BETTER_AUTH_URL is a localhost address ("sign-in and every emailed link would break"). It also
# makes better-auth mint secure-only cookies, which a browser will not store over plain http - so
# sign-in would loop. Dev mode skips that guard by design (see src/instrumentation.ts), which is
# the supported way to run this app on localhost.
#
# ── What this guarantees about safety ─────────────────────────────────────────────
# `.env` points at LIVE Supabase and has WhatsApp sending ARMED with no test recipient, so a
# browsable app on those settings could write to production and message real prospects. Every
# such variable is overridden here. Process env beats .env when Next loads it, so these win.

param([int]$Port = 3011)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$local = "postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public"

# ── The database: local, both the pooled and direct URLs ─────────────────────────
$env:DATABASE_URL = $local
$env:DIRECT_URL   = $local

# ── Every outbound channel OFF, not merely redirected ────────────────────────────
# Off rather than pointed at a dead endpoint: a dead endpoint still exercises the send path and
# logs FAILED rows, which makes the delivery-health screens lie about a system nobody armed.
$env:WATI_ENABLED  = "false"
$env:EMAIL_ENABLED = "false"
$env:SMS_ENABLED   = "false"
$env:INGEST_ENABLED = "false"
$env:AI_REVIEW_ENABLED = "false"
$env:ANTHROPIC_API_KEY = ""
$env:WATI_ACCESS_TOKEN = ""
$env:RESEND_API_KEY = ""
$env:TWILIO_ACCOUNT_SID = ""
$env:TWILIO_AUTH_TOKEN = ""
# Belt and braces: even if something ignores the flags above, only this unreachable number and
# address may be contacted (lib/outbound-allowlist).
$env:OUTBOUND_ALLOWLIST = "+10000000001,nobody@local.invalid"

# ── No production object storage ─────────────────────────────────────────────────
$env:SUPABASE_URL = ""
$env:SUPABASE_SERVICE_ROLE_KEY = ""
$env:SUPABASE_STORAGE_BUCKET = ""

# ── The app's own origin. MUST match the port, or better-auth refuses the sign-in with
#    "Invalid origin" and the login page simply bounces back to itself forever.
$env:BETTER_AUTH_URL = "http://localhost:$Port"
$env:EXTRA_TRUSTED_ORIGINS = "http://localhost:$Port,http://127.0.0.1:$Port"
$env:APP_DOMAIN = "localhost"
$env:TZ = "Asia/Kolkata"

# Its own build directory, so this never disturbs a `.next` or `.next-prod` built for anything
# else (a dev server and a production build sharing one directory corrupts both).
$env:NEXT_DIST_DIR = ".next-localdemo"

Write-Output "database  : local :5435"
Write-Output "outbound  : WhatsApp/email/SMS/AI all OFF"
Write-Output "url       : http://localhost:$Port"
Write-Output ""

npx next dev -p $Port
