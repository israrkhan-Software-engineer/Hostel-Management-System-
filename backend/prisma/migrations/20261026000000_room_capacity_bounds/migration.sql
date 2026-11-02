ALTER TABLE rooms
  ADD CONSTRAINT rooms_bed_capacity_range_check
  CHECK (bed_capacity BETWEEN 1 AND 10) NOT VALID;

ALTER TABLE rooms
  VALIDATE CONSTRAINT rooms_bed_capacity_range_check;