-- Stock allocation: when a SKU has stock spread across warehouses, orders
-- deduct from the lowest-priority-number warehouse that actually has
-- enough stock, falling back to the default warehouse if none do (rather
-- than silently picking one arbitrarily or blocking the order).
alter table warehouses add column allocation_priority int not null default 0;
