-- CreateTable
CREATE TABLE "consent_record" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "purpose" TEXT NOT NULL,
    "policyVersion" TEXT,
    "region" TEXT,
    "source" "Source" NOT NULL DEFAULT 'BOOKING_FORM',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_record_leadId_idx" ON "consent_record"("leadId");

-- CreateIndex
CREATE INDEX "consent_record_grantedAt_idx" ON "consent_record"("grantedAt");

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
