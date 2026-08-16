-- Phase 1: operational workflow (Dashboard -> Orders -> Allocation ->
-- GRN/Warehouse -> Picking -> Packing -> Shipping).
--
-- Architectural decision, made explicitly rather than silently: physical
-- stock still deducts from inventory_ledger at order-creation time (both
-- manual and sp-api-sync), unchanged from before. allocated_qty/picked_qty/
-- packed_qty/shipped_qty on order_line_items are workflow *counters*, not a
-- second stock-reservation ledger - "Available Stock" for allocation
-- purposes is physical stock minus what's already allocated to other open
-- orders. This avoids rewriting every existing stock-writing code path
-- (order creation, sp-api-sync, Returns, reorder alerts, Profit COGS) while
-- still giving the pick/pack/ship screens real progress counters to work
-- against.

-- ── Order status: extend to the full operational lifecycle ─────────────
alter type order_status rename value 'pending' to 'new';
alter type order_status add value 'confirmed' after 'new';
alter type order_status add value 'inventory_allocated' after 'confirmed';
alter type order_status add value 'partially_allocated' after 'inventory_allocated';
alter type order_status add value 'stock_shortage' after 'partially_allocated';
alter type order_status add value 'ready_to_pick' after 'stock_shortage';
alter type order_status add value 'picked' after 'ready_to_pick';
alter type order_status add value 'packed' after 'picked';
alter type order_status add value 'ready_to_ship' after 'packed';
alter type order_status add value 'rto' after 'returned';
