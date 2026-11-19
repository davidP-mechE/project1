-- 1:1 sessions made from office-hours bookings.
ALTER TABLE "ClassSession" ADD COLUMN "studentId" TEXT;

CREATE TABLE "OfficeHours" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 20,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxPerDay" INTEGER NOT NULL DEFAULT 6,
    "validFrom" TEXT NOT NULL,
    "validUntil" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfficeHours_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OfficeHours_staffId_idx" ON "OfficeHours"("staffId");
CREATE INDEX "OfficeHours_programId_idx" ON "OfficeHours"("programId");
ALTER TABLE "OfficeHours" ADD CONSTRAINT "OfficeHours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficeHours" ADD CONSTRAINT "OfficeHours_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bookings. The two unique "slot" keys are set only while BOOKED: no double-booking, even at the same moment.
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "staffSlot" TEXT,
    "studentSlot" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Booking_staffSlot_key" ON "Booking"("staffSlot");
CREATE UNIQUE INDEX "Booking_studentSlot_key" ON "Booking"("studentSlot");
CREATE UNIQUE INDEX "Booking_sessionId_key" ON "Booking"("sessionId");
CREATE INDEX "Booking_staffId_startsAt_idx" ON "Booking"("staffId", "startsAt");
CREATE INDEX "Booking_studentId_startsAt_idx" ON "Booking"("studentId", "startsAt");
CREATE INDEX "Booking_status_startsAt_idx" ON "Booking"("status", "startsAt");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
