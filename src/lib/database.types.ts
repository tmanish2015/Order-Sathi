export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          gst_number: string | null
          state: string | null
          address: string | null
          invoice_seq: number
          grn_seq: number
          transfer_seq: number
          cycle_count_seq: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          gst_number?: string | null
          state?: string | null
          address?: string | null
          invoice_seq?: number
          grn_seq?: number
          transfer_seq?: number
          cycle_count_seq?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          gst_number?: string | null
          state?: string | null
          address?: string | null
          invoice_seq?: number
          grn_seq?: number
          transfer_seq?: number
          cycle_count_seq?: number
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          organization_id: string
          full_name: string | null
          email: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          created_at: string
        }
        Insert: {
          id: string
          organization_id: string
          full_name?: string | null
          email: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          full_name?: string | null
          email?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          created_at?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          id: string
          organization_id: string
          marketplace_id: string
          seller_id: string
          display_name: string
          sp_api_refresh_token_secret_id: string | null
          connected_by: string | null
          connected_at: string | null
          status: string
          sync_status: string
          last_success_at: string | null
          last_failure_at: string | null
          sync_direction: string
          enabled: boolean
          config: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          marketplace_id: string
          seller_id: string
          display_name: string
          sp_api_refresh_token_secret_id?: string | null
          connected_by?: string | null
          connected_at?: string | null
          status?: string
          sync_status?: string
          last_success_at?: string | null
          last_failure_at?: string | null
          sync_direction?: string
          enabled?: boolean
          config?: Json
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["channels"]["Insert"]>
        Relationships: []
      }
      skus: {
        Row: {
          id: string
          organization_id: string
          sku: string
          asin: string | null
          barcode: string | null
          title: string
          hsn_code: string | null
          gst_rate: number
          buffer_stock: number
          active: boolean
          product_type: string | null
          cost_price: number
          is_bundle: boolean
          max_listed_stock: number | null
          reorder_level: number
          min_stock: number
          max_stock: number | null
          safety_stock: number
          reorder_qty: number
          lead_time_days: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          sku: string
          asin?: string | null
          barcode?: string | null
          title: string
          hsn_code?: string | null
          gst_rate?: number
          buffer_stock?: number
          active?: boolean
          product_type?: string | null
          cost_price?: number
          is_bundle?: boolean
          max_listed_stock?: number | null
          reorder_level?: number
          min_stock?: number
          max_stock?: number | null
          safety_stock?: number
          reorder_qty?: number
          lead_time_days?: number
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["skus"]["Insert"]>
        Relationships: []
      }
      bundle_components: {
        Row: {
          id: string
          organization_id: string
          bundle_sku_id: string
          component_sku_id: string
          quantity: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          bundle_sku_id: string
          component_sku_id: string
          quantity: number
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["bundle_components"]["Insert"]>
        Relationships: []
      }
      inventory_ledger: {
        Row: {
          id: string
          organization_id: string
          sku_id: string
          warehouse_id: string
          bin_id: string | null
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          quantity_delta: number
          order_id: string | null
          reference_type: string | null
          reference_id: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          sku_id: string
          warehouse_id: string
          bin_id?: string | null
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          quantity_delta: number
          order_id?: string | null
          reference_type?: string | null
          reference_id?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["inventory_ledger"]["Insert"]>
        Relationships: []
      }
      warehouses: {
        Row: {
          id: string
          organization_id: string
          name: string
          address: string | null
          is_default: boolean
          active: boolean
          allocation_priority: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          address?: string | null
          is_default?: boolean
          active?: boolean
          allocation_priority?: number
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["warehouses"]["Insert"]>
        Relationships: []
      }
      bins: {
        Row: {
          id: string
          organization_id: string
          warehouse_id: string
          code: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          warehouse_id: string
          code: string
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["bins"]["Insert"]>
        Relationships: []
      }
      picklists: {
        Row: {
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["picklist_status"]
          order_count: number
          assigned_to: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["picklist_status"]
          order_count?: number
          assigned_to?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["picklists"]["Insert"]>
        Relationships: []
      }
      picklist_items: {
        Row: {
          id: string
          organization_id: string
          picklist_id: string
          sku_id: string
          total_quantity: number
          picked_qty: number
          picked: boolean
          order_ids: string[]
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          picklist_id: string
          sku_id: string
          total_quantity: number
          picked_qty?: number
          picked?: boolean
          order_ids?: string[]
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["picklist_items"]["Insert"]>
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          organization_id: string
          channel_id: string
          amazon_order_id: string
          order_status: Database["public"]["Enums"]["order_status"]
          order_date: string
          buyer_state: string | null
          ship_state: string | null
          ship_address: string | null
          priority: Database["public"]["Enums"]["order_priority"]
          sla_due_at: string | null
          customer_name: string | null
          payment_type: string | null
          gross_amount: number
          raw_payload: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel_id: string
          amazon_order_id: string
          order_status?: Database["public"]["Enums"]["order_status"]
          order_date: string
          buyer_state?: string | null
          ship_state?: string | null
          ship_address?: string | null
          priority?: Database["public"]["Enums"]["order_priority"]
          sla_due_at?: string | null
          customer_name?: string | null
          payment_type?: string | null
          gross_amount: number
          raw_payload?: Json | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>
        Relationships: []
      }
      order_line_items: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          sku_id: string
          quantity: number
          unit_price: number
          allocated_qty: number
          picked_qty: number
          packed_qty: number
          shipped_qty: number
          warehouse_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          sku_id: string
          quantity: number
          unit_price: number
          allocated_qty?: number
          picked_qty?: number
          packed_qty?: number
          shipped_qty?: number
          warehouse_id?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["order_line_items"]["Insert"]>
        Relationships: []
      }
      order_status_history: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          previous_status: Database["public"]["Enums"]["order_status"] | null
          new_status: Database["public"]["Enums"]["order_status"]
          reason: string | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          previous_status?: Database["public"]["Enums"]["order_status"] | null
          new_status: Database["public"]["Enums"]["order_status"]
          reason?: string | null
          changed_by?: string | null
          changed_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["order_status_history"]["Insert"]>
        Relationships: []
      }
      grns: {
        Row: {
          id: string
          organization_id: string
          grn_number: string
          warehouse_id: string
          supplier_name: string | null
          reference_po: string | null
          status: Database["public"]["Enums"]["grn_status"]
          created_by: string | null
          created_at: string
          confirmed_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          grn_number: string
          warehouse_id: string
          supplier_name?: string | null
          reference_po?: string | null
          status?: Database["public"]["Enums"]["grn_status"]
          created_by?: string | null
          created_at?: string
          confirmed_at?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["grns"]["Insert"]>
        Relationships: []
      }
      grn_line_items: {
        Row: {
          id: string
          organization_id: string
          grn_id: string
          sku_id: string
          ordered_qty: number
          received_qty: number
          accepted_qty: number
          rejected_qty: number
          reason: string | null
          batch: string | null
          expiry: string | null
          remarks: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          grn_id: string
          sku_id: string
          ordered_qty?: number
          received_qty?: number
          accepted_qty?: number
          rejected_qty?: number
          reason?: string | null
          batch?: string | null
          expiry?: string | null
          remarks?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["grn_line_items"]["Insert"]>
        Relationships: []
      }
      stock_transfers: {
        Row: {
          id: string
          organization_id: string
          transfer_number: string
          source_warehouse_id: string
          destination_warehouse_id: string
          status: Database["public"]["Enums"]["transfer_status"]
          notes: string | null
          requested_by: string | null
          approved_by: string | null
          approved_at: string | null
          dispatched_by: string | null
          dispatched_at: string | null
          received_by: string | null
          received_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          transfer_number: string
          source_warehouse_id: string
          destination_warehouse_id: string
          status?: Database["public"]["Enums"]["transfer_status"]
          notes?: string | null
          requested_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          dispatched_by?: string | null
          dispatched_at?: string | null
          received_by?: string | null
          received_at?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["stock_transfers"]["Insert"]>
        Relationships: []
      }
      stock_transfer_items: {
        Row: {
          id: string
          organization_id: string
          transfer_id: string
          sku_id: string
          requested_qty: number
          dispatched_qty: number
          received_qty: number
          damaged_qty: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          transfer_id: string
          sku_id: string
          requested_qty?: number
          dispatched_qty?: number
          received_qty?: number
          damaged_qty?: number
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["stock_transfer_items"]["Insert"]>
        Relationships: []
      }
      cycle_counts: {
        Row: {
          id: string
          organization_id: string
          count_number: string
          warehouse_id: string
          bin_id: string | null
          status: Database["public"]["Enums"]["cycle_count_status"]
          scheduled_date: string | null
          notes: string | null
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          count_number: string
          warehouse_id: string
          bin_id?: string | null
          status?: Database["public"]["Enums"]["cycle_count_status"]
          scheduled_date?: string | null
          notes?: string | null
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["cycle_counts"]["Insert"]>
        Relationships: []
      }
      cycle_count_items: {
        Row: {
          id: string
          organization_id: string
          cycle_count_id: string
          sku_id: string
          system_qty: number
          physical_qty: number | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          cycle_count_id: string
          sku_id: string
          system_qty?: number
          physical_qty?: number | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["cycle_count_items"]["Insert"]>
        Relationships: []
      }
      packages: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          package_count: number
          weight_kg: number | null
          length_cm: number | null
          width_cm: number | null
          height_cm: number | null
          packed_by: string | null
          packed_at: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          package_count?: number
          weight_kg?: number | null
          length_cm?: number | null
          width_cm?: number | null
          height_cm?: number | null
          packed_by?: string | null
          packed_at?: string
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["packages"]["Insert"]>
        Relationships: []
      }
      shipments: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          courier_name: string
          awb_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          shipped_at: string
          tracking_url: string | null
          manifest_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          courier_name: string
          awb_number: string
          status?: Database["public"]["Enums"]["shipment_status"]
          shipped_at?: string
          tracking_url?: string | null
          manifest_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["shipments"]["Insert"]>
        Relationships: []
      }
      manifests: {
        Row: {
          id: string
          organization_id: string
          courier_name: string
          shipment_count: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          courier_name: string
          shipment_count?: number
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["manifests"]["Insert"]>
        Relationships: []
      }
      sku_channel_mappings: {
        Row: {
          id: string
          organization_id: string
          sku_id: string
          channel_id: string
          channel_sku: string
          channel_product_id: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          sku_id: string
          channel_id: string
          channel_sku: string
          channel_product_id?: string | null
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["sku_channel_mappings"]["Insert"]>
        Relationships: []
      }
      unmapped_sku_exceptions: {
        Row: {
          id: string
          organization_id: string
          channel_id: string
          channel_order_id: string
          channel_sku: string
          raw_payload: Json | null
          resolved: boolean
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel_id: string
          channel_order_id: string
          channel_sku: string
          raw_payload?: Json | null
          resolved?: boolean
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["unmapped_sku_exceptions"]["Insert"]>
        Relationships: []
      }
      couriers: {
        Row: {
          id: string
          organization_id: string
          name: string
          service_type: string | null
          cod_support: boolean
          api_status: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          service_type?: string | null
          cod_support?: boolean
          api_status?: string
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["couriers"]["Insert"]>
        Relationships: []
      }
      shipment_tracking_events: {
        Row: {
          id: string
          organization_id: string
          shipment_id: string
          status: Database["public"]["Enums"]["shipment_status"]
          event_time: string
          location: string | null
          remarks: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          shipment_id: string
          status: Database["public"]["Enums"]["shipment_status"]
          event_time?: string
          location?: string | null
          remarks?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["shipment_tracking_events"]["Insert"]>
        Relationships: []
      }
      ndr_records: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          shipment_id: string | null
          awb_number: string
          ndr_date: string
          reason: string | null
          attempt_number: number
          contact_status: string | null
          action_taken: string | null
          next_attempt_date: string | null
          outcome: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          shipment_id?: string | null
          awb_number: string
          ndr_date?: string
          reason?: string | null
          attempt_number?: number
          contact_status?: string | null
          action_taken?: string | null
          next_attempt_date?: string | null
          outcome?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["ndr_records"]["Insert"]>
        Relationships: []
      }
      settlement_transactions: {
        Row: {
          id: string
          organization_id: string
          channel_id: string
          settlement_id: string
          order_id: string | null
          channel_order_id: string
          transaction_id: string | null
          gross_amount: number
          fees: number
          taxes: number
          refunds: number
          adjustments: number
          net_amount: number
          settlement_date: string | null
          match_status: Database["public"]["Enums"]["reconciliation_status"]
          match_note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel_id: string
          settlement_id: string
          order_id?: string | null
          channel_order_id: string
          transaction_id?: string | null
          gross_amount?: number
          fees?: number
          taxes?: number
          refunds?: number
          adjustments?: number
          net_amount?: number
          settlement_date?: string | null
          match_status?: Database["public"]["Enums"]["reconciliation_status"]
          match_note?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["settlement_transactions"]["Insert"]>
        Relationships: []
      }
      gst_invoices: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          invoice_number: string
          invoice_type: Database["public"]["Enums"]["gst_invoice_type"]
          taxable_value: number
          cgst_amount: number
          sgst_amount: number
          igst_amount: number
          total_amount: number
          pdf_url: string | null
          issued_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          invoice_number: string
          invoice_type: Database["public"]["Enums"]["gst_invoice_type"]
          taxable_value: number
          cgst_amount?: number
          sgst_amount?: number
          igst_amount?: number
          total_amount: number
          pdf_url?: string | null
          issued_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["gst_invoices"]["Insert"]>
        Relationships: []
      }
      mtr_imports: {
        Row: {
          id: string
          organization_id: string
          channel_id: string
          filename: string
          period_start: string | null
          period_end: string | null
          row_count: number
          uploaded_by: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel_id: string
          filename: string
          period_start?: string | null
          period_end?: string | null
          row_count?: number
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["mtr_imports"]["Insert"]>
        Relationships: []
      }
      mtr_line_items: {
        Row: {
          id: string
          organization_id: string
          mtr_import_id: string
          amazon_order_id: string
          raw_row: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          mtr_import_id: string
          amazon_order_id: string
          raw_row: Json
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["mtr_line_items"]["Insert"]>
        Relationships: []
      }
      reconciliation_entries: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          mtr_line_item_id: string | null
          gross_sales: number
          commission: number
          tcs_cgst: number
          tcs_sgst: number
          tcs_igst: number
          tds_194o: number
          other_fees: number
          expected_settlement: number
          actual_settlement: number | null
          status: Database["public"]["Enums"]["reconciliation_status"]
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          mtr_line_item_id?: string | null
          gross_sales: number
          commission?: number
          tcs_cgst?: number
          tcs_sgst?: number
          tcs_igst?: number
          tds_194o?: number
          other_fees?: number
          expected_settlement: number
          actual_settlement?: number | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["reconciliation_entries"]["Insert"]>
        Relationships: []
      }
      order_returns: {
        Row: {
          id: string
          organization_id: string
          order_id: string
          order_line_item_id: string
          sku_id: string
          return_type: Database["public"]["Enums"]["return_type"]
          quantity: number
          reason: string | null
          status: Database["public"]["Enums"]["return_status"]
          expected_refund: number
          actual_refund: number | null
          restocked: boolean
          reviewed_by: string | null
          qc_outcome: Database["public"]["Enums"]["return_qc_outcome"] | null
          qc_notes: string | null
          qc_by: string | null
          qc_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          order_line_item_id: string
          sku_id: string
          return_type: Database["public"]["Enums"]["return_type"]
          quantity: number
          reason?: string | null
          status?: Database["public"]["Enums"]["return_status"]
          expected_refund?: number
          actual_refund?: number | null
          restocked?: boolean
          reviewed_by?: string | null
          qc_outcome?: Database["public"]["Enums"]["return_qc_outcome"] | null
          qc_notes?: string | null
          qc_by?: string | null
          qc_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["order_returns"]["Insert"]>
        Relationships: []
      }
      sync_logs: {
        Row: {
          id: string
          organization_id: string
          channel_id: string | null
          operation: string
          status: Database["public"]["Enums"]["log_status"]
          fault: Database["public"]["Enums"]["log_fault"] | null
          message: string
          detail: Json | null
          sync_type: string | null
          records_processed: number
          records_successful: number
          records_failed: number
          started_at: string
          finished_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          channel_id?: string | null
          operation: string
          status: Database["public"]["Enums"]["log_status"]
          fault?: Database["public"]["Enums"]["log_fault"] | null
          message: string
          detail?: Json | null
          sync_type?: string | null
          records_processed?: number
          records_successful?: number
          records_failed?: number
          started_at?: string
          finished_at?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["sync_logs"]["Insert"]>
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          organization_id: string
          table_name: string
          record_id: string
          action: string
          old_value: Json | null
          new_value: Json | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          table_name: string
          record_id: string
          action: string
          old_value?: Json | null
          new_value?: Json | null
          changed_by?: string | null
          changed_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_id: { Args: Record<PropertyKey, never>; Returns: string }
      auth_role: { Args: Record<PropertyKey, never>; Returns: Database["public"]["Enums"]["user_role"] }
      approve_team_member: {
        Args: { p_user_id: string; p_role: Database["public"]["Enums"]["user_role"] }
        Returns: undefined
      }
      next_invoice_number: { Args: Record<PropertyKey, never>; Returns: string }
      next_grn_number: { Args: Record<PropertyKey, never>; Returns: string }
      next_transfer_number: { Args: Record<PropertyKey, never>; Returns: string }
      next_cycle_count_number: { Args: Record<PropertyKey, never>; Returns: string }
    }
    Enums: {
      user_role: "admin" | "ops" | "finance"
      user_status: "pending" | "active"
      inventory_movement_type: "order_deduction" | "manual_adjustment" | "restock" | "return" | "damaged" | "transfer_out" | "transfer_in"
      transfer_status: "requested" | "approved" | "dispatched" | "in_transit" | "received" | "rejected"
      cycle_count_status: "scheduled" | "counting" | "pending_approval" | "approved" | "rejected"
      order_status:
        | "new"
        | "confirmed"
        | "inventory_allocated"
        | "partially_allocated"
        | "stock_shortage"
        | "ready_to_pick"
        | "picked"
        | "packed"
        | "ready_to_ship"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "returned"
        | "rto"
      gst_invoice_type: "intra_state" | "inter_state"
      reconciliation_status: "matched" | "mismatch" | "pending_review" | "resolved" | "ignored"
      log_fault: "amazon" | "order_sathi" | "seller_data" | "unknown"
      log_status: "running" | "success" | "failed" | "partial"
      return_type: "customer_return" | "rto"
      return_status: "initiated" | "in_transit" | "received" | "qc_pending" | "qc_complete" | "refunded"
      return_qc_outcome: "resalable" | "damaged" | "missing_item" | "wrong_item" | "partial" | "rejected"
      picklist_status: "created" | "assigned" | "picking" | "picked" | "completed"
      grn_status: "draft" | "confirmed"
      shipment_status:
        | "courier_assigned"
        | "awb_assigned"
        | "manifested"
        | "shipped"
        | "in_transit"
        | "ndr"
        | "delivered"
        | "rto"
        | "cancelled"
        | "failed"
      order_priority: "normal" | "high" | "urgent"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]
