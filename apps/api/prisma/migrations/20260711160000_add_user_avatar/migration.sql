-- Add optional avatar object-storage key to users.
ALTER TABLE "users" ADD COLUMN "avatarPath" TEXT;
