-- Clear all operational demo data while preserving branches, buildings, rooms, beds, roles, permissions and staff user accounts.
BEGIN;

-- 1. Operational finance data
DELETE FROM refunds;
DELETE FROM payments;
DELETE FROM invoice_lines;
DELETE FROM invoices;

-- 2. Gate & visitors
DELETE FROM visitor_visits;

-- 3. Complaints & notices
DELETE FROM complaints;
DELETE FROM notices;

-- 4. Mess menus & entries
DELETE FROM mess_menu_entries;
DELETE FROM mess_menus;

-- 5. Bed allocations & admissions
DELETE FROM bed_allocations;
DELETE FROM admissions;

-- 6. Residents
DELETE FROM residents;

-- 7. Reset all beds to AVAILABLE
UPDATE beds SET status = 'AVAILABLE';

-- 8. Clean audit logs relating to demo data
DELETE FROM audit_logs WHERE entity_type IN ('resident', 'admission', 'bed_allocation', 'invoice', 'payment', 'refund', 'complaint', 'notice', 'visitor_visit', 'mess_menu') OR entity_type IS NULL;

-- 9. Clean refresh tokens
DELETE FROM refresh_tokens;

COMMIT;
