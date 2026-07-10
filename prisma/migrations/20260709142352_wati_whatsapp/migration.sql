-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppKind" AS ENUM ('DISCO_REMINDER', 'BOOKING_CONFIRMATION', 'BOOKING_REMINDER', 'NO_SHOW_FOLLOWUP', 'PAYMENT_REMINDER', 'CHECKIN_NUDGE', 'SPRINT_MISS_NUDGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('SKIPPED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_message" (
    "id" TEXT NOT NULL,
    "direction" "WhatsAppDirection" NOT NULL DEFAULT 'OUTBOUND',
    "kind" "WhatsAppKind" NOT NULL,
    "status" "WhatsAppStatus" NOT NULL DEFAULT 'QUEUED',
    "toNumber" TEXT NOT NULL,
    "templateName" TEXT,
    "body" TEXT,
    "params" JSONB,
    "watiMessageId" TEXT,
    "error" TEXT,
    "leadId" TEXT,
    "studentId" TEXT,
    "bookingRequestId" TEXT,
    "pendingPaymentId" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_opt_out" (
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_opt_out_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE INDEX "whatsapp_message_kind_createdAt_idx" ON "whatsapp_message"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_message_leadId_idx" ON "whatsapp_message"("leadId");

-- CreateIndex
CREATE INDEX "whatsapp_message_studentId_idx" ON "whatsapp_message"("studentId");

-- CreateIndex
CREATE INDEX "whatsapp_message_bookingRequestId_idx" ON "whatsapp_message"("bookingRequestId");

-- CreateIndex
CREATE INDEX "whatsapp_message_pendingPaymentId_idx" ON "whatsapp_message"("pendingPaymentId");

-- CreateIndex
CREATE INDEX "whatsapp_message_watiMessageId_idx" ON "whatsapp_message"("watiMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_message_toNumber_idx" ON "whatsapp_message"("toNumber");

-- AddForeignKey
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_bookingRequestId_fkey" FOREIGN KEY ("bookingRequestId") REFERENCES "booking_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_pendingPaymentId_fkey" FOREIGN KEY ("pendingPaymentId") REFERENCES "pending_payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
