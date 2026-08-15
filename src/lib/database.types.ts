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
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          gst_number?: string | null
          state?: string | null
          address?: string | null
          invoice_seq?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          gst_number?: string | null
          state?: string | null
          address?: string | null
          invoice_seq?: number
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
          title: string
          hsn_code: string | null
          gst_rate: number
          buffer_stock: number
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          sku: string
          asin?: string | null
          title: string
          hsn_code?: string | null
          gst_rate?: number
          buffer_stock?: number
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["skus"]["Insert"]>
        Relationships: []
      }
      inventory_ledger: {
        Row: {
          id: string
          organization_id: string
          sku_id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          quantity_delta: number
          order_id: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          sku_id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          quantity_delta: number
          order_id?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["inventory_ledger"]["Insert"]>
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
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          order_id: string
          sku_id: string
          quantity: number
          unit_price: number
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["order_line_items"]["Insert"]>
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
    }
    Enums: {
      user_role: "admin" | "ops" | "finance"
      user_status: "pending" | "active"
      inventory_movement_type: "order_deduction" | "manual_adjustment" | "restock" | "return"
      order_status: "pending" | "shipped" | "delivered" | "cancelled" | "returned"
      gst_invoice_type: "intra_state" | "inter_state"
      reconciliation_status: "matched" | "mismatch" | "pending_review"
      log_fault: "amazon" | "order_sathi" | "seller_data" | "unknown"
      log_status: "success" | "failed" | "partial"
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
