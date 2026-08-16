-- Cost price (COGS) per SKU — the missing input for real per-SKU profit,
-- not just revenue. Defaults to 0 so nothing breaks for existing SKUs;
-- profit for those simply reads as 100% margin until the seller fills it in.
alter table skus add column cost_price numeric(12,2) not null default 0;
