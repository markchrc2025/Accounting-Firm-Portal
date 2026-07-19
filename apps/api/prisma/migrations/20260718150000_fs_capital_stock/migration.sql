-- Capital-stock profile fields for the FS Capital Stock note.
ALTER TABLE "fs_reports" ADD COLUMN "authorizedShares" INTEGER;
ALTER TABLE "fs_reports" ADD COLUMN "issuedShares" INTEGER;
ALTER TABLE "fs_reports" ADD COLUMN "parValue" DECIMAL(18,2);
