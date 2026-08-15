-- Full shipping address for the GST invoice, separate from ship_state
-- (which stays as-is, used for the CGST/SGST vs IGST place-of-supply check).
alter table orders add column ship_address text;
