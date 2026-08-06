-- Per-user work time, one row per IST calendar day.
--
-- Updated in place by the heartbeat (src/app/api/work-time/route.ts), so this
-- table is deliberately NOT added to the append_only_guards trigger list.

-- CreateTable
CREATE TABLE "work_day" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_day_userId_day_idx" ON "work_day"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "work_day_userId_day_key" ON "work_day"("userId", "day");

-- AddForeignKey
ALTER TABLE "work_day" ADD CONSTRAINT "work_day_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
