-- When a BIR form is marked filed, stamp the time (cleared on reopen).
ALTER TABLE "bir_forms" ADD COLUMN "filedAt" TIMESTAMP(3);
