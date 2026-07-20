-- Atomic per-firm-per-year control-number counter for firm billings.
CREATE TABLE "billing_counters" (
    "firmId" UUID NOT NULL,
    "year" TEXT NOT NULL,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "billing_counters_pkey" PRIMARY KEY ("firmId", "year")
);
