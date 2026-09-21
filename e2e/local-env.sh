# Every variable that could reach production or a real person is overridden here.
# Process env beats both .env and .env.production when Next loads them.
export LOCAL_DB="postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public"
export DATABASE_URL="$LOCAL_DB" DIRECT_URL="$LOCAL_DB"
export PORT=3100 NEXT_DIST_DIR=.next-verify3
export BETTER_AUTH_URL="https://127.0.0.1:3100" EXTRA_TRUSTED_ORIGINS="http://localhost:3100,http://127.0.0.1:3100,https://127.0.0.1:3100"
export TZ="Asia/Kolkata"
export CRON_SECRET="e2e-cron-secret-local-only"
export OUTBOUND_ALLOWLIST="+10000000001,nobody@e2e.invalid"
export WATI_ENABLED="true" WATI_API_ENDPOINT="http://127.0.0.1:9" WATI_ACCESS_TOKEN="e2e-invalid" WATI_WEBHOOK_SECRET="e2e-wati"
export EMAIL_ENABLED="true" RESEND_API_KEY="re_e2e_invalid" RESEND_WEBHOOK_SECRET="e2e-resend"
export SMS_ENABLED="false" TWILIO_ACCOUNT_SID="" TWILIO_AUTH_TOKEN=""
export AI_REVIEW_ENABLED="false" ANTHROPIC_API_KEY=""
export META_VERIFY_TOKEN="e2e" META_APP_SECRET="e2e" META_PAGE_ACCESS_TOKEN=""
export PABBLY_WEBHOOK_SECRET="e2e-pabbly" FLEXIFUNNELS_WEBHOOK_SECRET="e2e-flexi"
export SUPABASE_URL="" SUPABASE_SERVICE_ROLE_KEY="" SUPABASE_STORAGE_BUCKET=""
export REDIS_URL="redis://localhost:6379/9"
export INGEST_ENABLED="false" APP_DOMAIN="localhost"
