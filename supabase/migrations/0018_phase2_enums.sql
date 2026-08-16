-- Phase 2 enum changes. Run alone, separate transaction from 0019 (new
-- enum values can't be used in the same transaction that adds them).

-- ── Shipment lifecycle: courier_assigned -> awb_assigned -> manifested ->
--    shipped -> in_transit -> (ndr ->) delivered, or rto/cancelled/failed
alter type shipment_status rename value 'booked' to 'awb_assigned';
alter type shipment_status add value 'courier_assigned' before 'awb_assigned';
alter type shipment_status add value 'manifested' after 'awb_assigned';
alter type shipment_status add value 'shipped' after 'manifested';
alter type shipment_status add value 'ndr' after 'in_transit';
alter type shipment_status add value 'cancelled' after 'rto';

-- ── Returns/RTO: add the transit/QC stages between "initiated" and "refunded"
alter type return_status add value 'in_transit' after 'initiated';
alter type return_status add value 'qc_pending' after 'received';
alter type return_status add value 'qc_complete' after 'qc_pending';

create type return_qc_outcome as enum ('resalable', 'damaged', 'missing_item', 'wrong_item', 'partial', 'rejected');

-- ── Reconciliation exception queue statuses
alter type reconciliation_status add value 'resolved' after 'pending_review';
alter type reconciliation_status add value 'ignored' after 'resolved';

-- ── Sync logs: a run in progress, not just its final outcome
alter type log_status add value 'running' before 'success';

-- ── Damaged stock is a distinct movement from a normal resalable return
alter type inventory_movement_type add value 'damaged' after 'return';
