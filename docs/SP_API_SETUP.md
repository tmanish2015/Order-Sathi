# Amazon SP-API setup checklist

Everything in the app is built and waiting on this. Work through it in order — each step unblocks the next.

## 1. Database migrations

Run these in the Supabase dashboard, SQL Editor, in order, if not already done:

- [ ] `supabase/migrations/0001_init.sql`
- [ ] `supabase/migrations/0002_gst_invoicing.sql`
- [ ] `supabase/migrations/0003_inventory_push.sql`

## 2. Register the SP-API app (Seller Central)

- [ ] Seller Central → **Apps & Services → Develop Apps** → create a new private app
- [ ] Note the **LWA Client ID** and **LWA Client Secret**
- [ ] Under the app's API access, request the **Orders**, **Inventory and Order Tracking (Listings)**, and **Product Listing** roles
- [ ] Authorize the app against your own seller account (Seller Central will walk you through this) — this produces a **refresh token**. Copy it immediately; Amazon only shows it once.

## 3. Store secrets

- [ ] In Supabase dashboard → **Edge Functions → Secrets**, set:
  - `LWA_CLIENT_ID`
  - `LWA_CLIENT_SECRET`
- [ ] Store the refresh token in **Supabase Vault** (SQL Editor):
  ```sql
  select vault.create_secret('<your refresh token>', 'amazon-refresh-token');
  ```
  This returns a `id` (uuid) — that's the secret ID for the next step.

## 4. Deploy the edge functions

From the project folder (needs the Supabase CLI, `npm install -g supabase` if not already):

```bash
supabase link --project-ref vdunwigbvdtzfsxijagw
supabase functions deploy sp-api-sync
supabase functions deploy sp-api-inventory-push
```

## 5. Connect the channel

In the SQL Editor, insert your channel row (replace the placeholders):

```sql
insert into channels (organization_id, marketplace_id, seller_id, display_name, sp_api_refresh_token_secret_id, status)
values (
  (select id from organizations limit 1),
  'A21TJRUUN4KGV', -- India marketplace
  '<your Amazon Seller ID>',
  'Amazon India',
  '<the vault secret id from step 3>',
  'connected'
);
```

## 6. Add your SKUs

Before pushing inventory or pulling orders that reference them, add each SKU under **Inventory** in the app — SKU code, title, GST rate, buffer stock. Fill in **product type** (e.g. `LUGGAGE`, `SHOES`) for each — the inventory push needs it, will skip and log any SKU missing it.

## 7. First real run

- [ ] Manually invoke `sp-api-sync` once (via the Supabase dashboard's function test panel, or `curl`) with `{"channel_id": "<channel id>"}` — check **Sync Logs** in the app for what happened
- [ ] If orders came in, try **Push to Amazon** from the Inventory page
- [ ] Generate a GST invoice for a real order from the Orders page, check the PDF looks right
- [ ] Once you have a real MTR export, upload it on the Reconciliation page — check the import summary for any columns it couldn't find, tell me the actual header names so I can fix the alias list

## Later (not blocking today)

- `sp-api-sync` isn't scheduled — nothing pulls orders automatically yet. Once step 7 confirms it works, wire it to a cron (Supabase scheduled function or an external trigger hitting the function URL).
