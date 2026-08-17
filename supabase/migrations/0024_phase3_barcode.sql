-- Phase 3 Module 1: barcode field on skus for scan-to-identify in
-- GRN/inward and picking/outward. Optional (not every SKU has one),
-- unique per organization only (two sellers' catalogs can legitimately
-- share a manufacturer barcode).

alter table skus add column barcode text;

create unique index skus_org_barcode_key on skus (organization_id, barcode) where barcode is not null;
