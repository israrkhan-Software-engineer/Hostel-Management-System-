ALTER TABLE student_discounts
  ADD COLUMN IF NOT EXISTS "invoiceId" UUID REFERENCES invoices(id);
