-- Amazon's Listings Items API needs each SKU's productType to patch its
-- fulfillment_availability — there's no way to push a quantity without it.
alter table skus add column product_type text;
