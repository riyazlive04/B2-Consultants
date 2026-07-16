-- CreateEnum
CREATE TYPE "GnWorkshopStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GnWorkshopProduct" AS ENUM ('A1', 'A2', 'B1', 'A1_A2', 'A2_B1', 'A1_A2_B1');

-- CreateEnum
CREATE TYPE "GnWorkshopDayType" AS ENUM ('WEEKDAY', 'WEEKEND');

-- CreateEnum
CREATE TYPE "GnConversionStatus" AS ENUM ('CONFIRMED', 'ON_HOLD');

-- CreateTable
CREATE TABLE "gn_workshop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "status" "GnWorkshopStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_workshop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_workshop_adset" (
    "id" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "label" TEXT,
    "adSpendInrMinor" BIGINT NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER NOT NULL DEFAULT 0,
    "attended" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gn_workshop_adset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gn_workshop_conversion" (
    "id" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "product" "GnWorkshopProduct" NOT NULL,
    "dayType" "GnWorkshopDayType" NOT NULL DEFAULT 'WEEKDAY',
    "batchA1" TEXT,
    "timeA1" TEXT,
    "batchA2" TEXT,
    "timeA2" TEXT,
    "batchB1" TEXT,
    "timeB1" TEXT,
    "status" "GnConversionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "isFreeSeat" BOOLEAN NOT NULL DEFAULT false,
    "finalPriceInrMinor" BIGINT NOT NULL DEFAULT 0,
    "paidAmountInrMinor" BIGINT NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "nextDueDate" DATE,
    "booksCostInrMinor" BIGINT NOT NULL DEFAULT 0,
    "tutorCostInrMinor" BIGINT NOT NULL DEFAULT 0,
    "adSpendInrMinor" BIGINT NOT NULL DEFAULT 0,
    "referralInrMinor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gn_workshop_conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gn_workshop_status_idx" ON "gn_workshop"("status");

-- CreateIndex
CREATE INDEX "gn_workshop_adset_workshopId_idx" ON "gn_workshop_adset"("workshopId");

-- CreateIndex
CREATE INDEX "gn_workshop_conversion_workshopId_idx" ON "gn_workshop_conversion"("workshopId");

-- AddForeignKey
ALTER TABLE "gn_workshop_adset" ADD CONSTRAINT "gn_workshop_adset_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "gn_workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gn_workshop_conversion" ADD CONSTRAINT "gn_workshop_conversion_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "gn_workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
