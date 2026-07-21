-- Per-line tax treatment for firm billings. Existing lines default to "VAT12"
-- so historical invoices reproduce their stored 12% VAT if re-saved; new lines
-- created by the app send an explicit taxCode ("VAT12" or "NONE").
ALTER TABLE "invoice_line_items" ADD COLUMN "taxCode" TEXT NOT NULL DEFAULT 'VAT12';
