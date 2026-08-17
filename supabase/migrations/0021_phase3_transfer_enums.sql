-- Phase 3: stock transfer enums (enum-only migration, must run and commit
-- before 0022 which creates tables using these values).

create type transfer_status as enum ('requested', 'approved', 'dispatched', 'in_transit', 'received', 'rejected');

alter type inventory_movement_type add value 'transfer_out';
alter type inventory_movement_type add value 'transfer_in';
