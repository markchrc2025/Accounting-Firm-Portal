-- Add province/region to Client for address slicing + ZIP autofill source.
ALTER TABLE "clients" ADD COLUMN "province" TEXT;
ALTER TABLE "clients" ADD COLUMN "region" TEXT;
