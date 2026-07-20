-- Creditable withholding tax withheld from the supplier on a purchase line
-- (amount only; the ATC code already lives in "atc"). Coexists with input VAT.
ALTER TABLE "purchase_transactions" ADD COLUMN "whtAmount" DECIMAL(18,2);
