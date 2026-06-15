-- Add pickup address snapshot and live pickup trip tracking.
CREATE TYPE "PickupTripStatus" AS ENUM ('NOT_STARTED', 'PICKED_UP', 'IN_TRANSIT_TO_GARAGE', 'ARRIVED_GARAGE');

ALTER TABLE "Booking"
  ADD COLUMN "pickupAddress" TEXT,
  ADD COLUMN "pickupLandmark" TEXT,
  ADD COLUMN "pickupCity" TEXT,
  ADD COLUMN "pickupLat" DOUBLE PRECISION,
  ADD COLUMN "pickupLng" DOUBLE PRECISION,
  ADD COLUMN "pickupContactName" TEXT,
  ADD COLUMN "pickupContactPhone" TEXT,
  ADD COLUMN "pickupNotes" TEXT;

CREATE TABLE "PickupTrip" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "employeeMembershipId" TEXT,
  "status" "PickupTripStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "startedAt" TIMESTAMP(3),
  "reachedGarageAt" TIMESTAMP(3),
  "lastEtaMin" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PickupTrip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupTripPoint" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "speed" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PickupTripPoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickupTrip_bookingId_key" ON "PickupTrip"("bookingId");
CREATE INDEX "PickupTrip_status_idx" ON "PickupTrip"("status");
CREATE INDEX "PickupTrip_employeeMembershipId_idx" ON "PickupTrip"("employeeMembershipId");
CREATE INDEX "PickupTripPoint_tripId_recordedAt_idx" ON "PickupTripPoint"("tripId", "recordedAt");

ALTER TABLE "PickupTrip"
  ADD CONSTRAINT "PickupTrip_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PickupTripPoint"
  ADD CONSTRAINT "PickupTripPoint_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "PickupTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
