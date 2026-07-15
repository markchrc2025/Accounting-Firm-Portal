-- Financial Statement Creator (standalone module).
-- firmId / accountCode / createdById are validated scalars, not FKs into
-- Firm / ChartAccount / User — the module owns no relations outside itself.

CREATE TABLE "fs_reports" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "entityName" TEXT NOT NULL,
    "secRegistrationNo" TEXT,
    "registeredAddress" TEXT,
    "businessDescription" TEXT,
    "framework" TEXT NOT NULL DEFAULT 'PFRS for Small Entities',
    "functionalCurrency" TEXT NOT NULL DEFAULT 'PHP',
    "approvalDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fs_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fs_reports_firmId_idx" ON "fs_reports"("firmId");

CREATE TABLE "fs_periods" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "endDate" DATE NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'FY',
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "fs_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fs_periods_reportId_sortOrder_key" ON "fs_periods"("reportId", "sortOrder");

CREATE TABLE "trial_balance_entries" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "trial_balance_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trial_balance_entries_reportId_idx" ON "trial_balance_entries"("reportId");
CREATE UNIQUE INDEX "trial_balance_entries_periodId_accountCode_key" ON "trial_balance_entries"("periodId", "accountCode");

CREATE TABLE "fs_adjustments" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fs_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fs_adjustments_reportId_idx" ON "fs_adjustments"("reportId");

CREATE TABLE "fs_adjustment_lines" (
    "id" UUID NOT NULL,
    "adjustmentId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fs_adjustment_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fs_adjustment_lines_adjustmentId_idx" ON "fs_adjustment_lines"("adjustmentId");

ALTER TABLE "fs_periods" ADD CONSTRAINT "fs_periods_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "fs_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trial_balance_entries" ADD CONSTRAINT "trial_balance_entries_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "fs_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trial_balance_entries" ADD CONSTRAINT "trial_balance_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fs_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fs_adjustments" ADD CONSTRAINT "fs_adjustments_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "fs_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fs_adjustment_lines" ADD CONSTRAINT "fs_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "fs_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
