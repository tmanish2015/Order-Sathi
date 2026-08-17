-- Phase 3: catalog enhancement. hsn_code/gst_rate already existed
-- (Phase 0) - this adds the remaining product-master fields the ABC/FSN
-- category filter and a real catalog view need. All optional, no
-- redesign of the product master's identity (sku/organization_id still
-- the primary key/tenant scope).

alter table skus
  add column brand text,
  add column category text,
  add column subcategory text,
  add column description text,
  add column image_url text,
  add column weight_kg numeric(8,3),
  add column length_cm numeric(8,2),
  add column width_cm numeric(8,2),
  add column height_cm numeric(8,2),
  add column attributes jsonb not null default '{}'::jsonb;

create index skus_category_idx on skus (organization_id, category) where category is not null;
