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
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          organization_id: string
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          organization_id: string
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          organization_id?: string
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      campaign_posts: {
        Row: {
          campaign_id: string
          content: string | null
          created_at: string
          created_by: string | null
          creative_id: string | null
          external_post_id: string | null
          id: string
          is_demo: boolean
          media_urls: string[]
          mode: Database["public"]["Enums"]["post_mode"]
          organization_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          posted_at: string | null
          scheduled_at: string
          social_account_id: string | null
          status: Database["public"]["Enums"]["post_status"]
        }
        Insert: {
          campaign_id: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          external_post_id?: string | null
          id?: string
          is_demo?: boolean
          media_urls?: string[]
          mode?: Database["public"]["Enums"]["post_mode"]
          organization_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          posted_at?: string | null
          scheduled_at: string
          social_account_id?: string | null
          status?: Database["public"]["Enums"]["post_status"]
        }
        Update: {
          campaign_id?: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          external_post_id?: string | null
          id?: string
          is_demo?: boolean
          media_urls?: string[]
          mode?: Database["public"]["Enums"]["post_mode"]
          organization_id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          posted_at?: string | null
          scheduled_at?: string
          social_account_id?: string | null
          status?: Database["public"]["Enums"]["post_status"]
        }
        Relationships: []
      }
      creatives: {
        Row: {
          canvas_data: Json
          created_at: string
          created_by: string | null
          customer_id: string | null
          height: number
          id: string
          is_demo: boolean
          name: string
          organization_id: string
          thumbnail_url: string | null
          updated_at: string
          width: number
        }
        Insert: {
          canvas_data?: Json
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          height?: number
          id?: string
          is_demo?: boolean
          name: string
          organization_id: string
          thumbnail_url?: string | null
          updated_at?: string
          width?: number
        }
        Update: {
          canvas_data?: Json
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          height?: number
          id?: string
          is_demo?: boolean
          name?: string
          organization_id?: string
          thumbnail_url?: string | null
          updated_at?: string
          width?: number
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          is_demo: boolean
          name: string
          objective: string | null
          organization_id: string
          platforms: Database["public"]["Enums"]["social_platform"][]
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          name: string
          objective?: string | null
          organization_id: string
          platforms?: Database["public"]["Enums"]["social_platform"][]
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          objective?: string | null
          organization_id?: string
          platforms?: Database["public"]["Enums"]["social_platform"][]
          status?: string
        }
        Relationships: []
      }
      client_error_log: {
        Row: {
          context: string
          created_at: string
          id: string
          message: string
          organization_id: string
          user_id: string | null
        }
        Insert: {
          context: string
          created_at?: string
          id?: string
          message: string
          organization_id: string
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          id?: string
          message?: string
          organization_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          company_name: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          customer_type: Database["public"]["Enums"]["customer_type"]
          email: string | null
          gst_number: string | null
          has_lut: boolean
          id: string
          is_demo: boolean
          organization_id: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          company_name: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: Database["public"]["Enums"]["customer_type"]
          email?: string | null
          gst_number?: string | null
          has_lut?: boolean
          id?: string
          is_demo?: boolean
          organization_id: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          company_name?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: Database["public"]["Enums"]["customer_type"]
          email?: string | null
          gst_number?: string | null
          has_lut?: boolean
          id?: string
          is_demo?: boolean
          organization_id?: string
          phone?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          customer_id: string
          id: string
          is_demo: boolean
          issued_at: string
          organization_id: string
          paid_at: string | null
          razorpay_invoice_id: string | null
          razorpay_payment_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string
        }
        Insert: {
          amount: number
          customer_id: string
          id?: string
          is_demo?: boolean
          issued_at?: string
          organization_id: string
          paid_at?: string | null
          razorpay_invoice_id?: string | null
          razorpay_payment_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string
        }
        Update: {
          amount?: number
          customer_id?: string
          id?: string
          is_demo?: boolean
          issued_at?: string
          organization_id?: string
          paid_at?: string | null
          razorpay_invoice_id?: string | null
          razorpay_payment_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          activity_type: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          notes: string | null
          organization_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          organization_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          organization_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          assigned_to: string | null
          campaign_id: string | null
          company: string | null
          converted_customer_id: string | null
          created_at: string
          email: string | null
          id: string
          is_demo: boolean
          name: string
          organization_id: string
          phone: string | null
          raw_payload: Json | null
          score: number
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
        }
        Insert: {
          assigned_to?: string | null
          campaign_id?: string | null
          company?: string | null
          converted_customer_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_demo?: boolean
          name: string
          organization_id: string
          phone?: string | null
          raw_payload?: Json | null
          score?: number
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
        }
        Update: {
          assigned_to?: string | null
          campaign_id?: string | null
          company?: string | null
          converted_customer_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          organization_id?: string
          phone?: string | null
          raw_payload?: Json | null
          score?: number
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_demo: boolean
          notes: string | null
          organization_id: string
          status: Database["public"]["Enums"]["opportunity_status"]
          suggested_plan_id: string | null
          type: Database["public"]["Enums"]["opportunity_type"]
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          suggested_plan_id?: string | null
          type: Database["public"]["Enums"]["opportunity_type"]
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          suggested_plan_id?: string | null
          type?: Database["public"]["Enums"]["opportunity_type"]
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          event_type: string
          id: string
          organization_id: string
          payload: Json
          received_at: string
          subscription_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          organization_id: string
          payload: Json
          received_at?: string
          subscription_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          received_at?: string
          subscription_id?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          amount: number
          billing_cycle: Database["public"]["Enums"]["billing_cycle"]
          category: Database["public"]["Enums"]["plan_category"]
          created_at: string
          deliverable_qty: number | null
          deliverable_unit: string | null
          id: string
          is_demo: boolean
          name: string
          organization_id: string
          razorpay_plan_id: string | null
        }
        Insert: {
          active?: boolean
          amount: number
          billing_cycle: Database["public"]["Enums"]["billing_cycle"]
          category?: Database["public"]["Enums"]["plan_category"]
          created_at?: string
          deliverable_qty?: number | null
          deliverable_unit?: string | null
          id?: string
          is_demo?: boolean
          name: string
          organization_id: string
          razorpay_plan_id?: string | null
        }
        Update: {
          active?: boolean
          amount?: number
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          category?: Database["public"]["Enums"]["plan_category"]
          created_at?: string
          deliverable_qty?: number | null
          deliverable_unit?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          organization_id?: string
          razorpay_plan_id?: string | null
        }
        Relationships: []
      }
      post_metrics: {
        Row: {
          campaign_post_id: string
          clicks: number
          engagement: number
          fetched_at: string
          id: string
          organization_id: string
          reach: number
        }
        Insert: {
          campaign_post_id: string
          clicks?: number
          engagement?: number
          fetched_at?: string
          id?: string
          organization_id: string
          reach?: number
        }
        Update: {
          campaign_post_id?: string
          clicks?: number
          engagement?: number
          fetched_at?: string
          id?: string
          organization_id?: string
          reach?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          access_token_secret_id: string | null
          account_name: string
          connected_at: string
          connected_by: string | null
          expires_at: string | null
          id: string
          organization_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          status: string
        }
        Insert: {
          access_token_secret_id?: string | null
          account_name: string
          connected_at?: string
          connected_by?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          platform: Database["public"]["Enums"]["social_platform"]
          status?: string
        }
        Update: {
          access_token_secret_id?: string | null
          account_name?: string
          connected_at?: string
          connected_by?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          status?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          customer_id: string
          failed_charge_count: number
          id: string
          is_demo: boolean
          next_due_date: string | null
          organization_id: string
          plan_id: string
          razorpay_customer_id: string | null
          razorpay_subscription_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["subscription_status"]
        }
        Insert: {
          created_at?: string
          customer_id: string
          failed_charge_count?: number
          id?: string
          is_demo?: boolean
          next_due_date?: string | null
          organization_id: string
          plan_id: string
          razorpay_customer_id?: string | null
          razorpay_subscription_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["subscription_status"]
        }
        Update: {
          created_at?: string
          customer_id?: string
          failed_charge_count?: number
          id?: string
          is_demo?: boolean
          next_due_date?: string | null
          organization_id?: string
          plan_id?: string
          razorpay_customer_id?: string | null
          razorpay_subscription_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["subscription_status"]
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          description: string | null
          due_date: string | null
          id: string
          is_demo: boolean
          organization_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_demo?: boolean
          organization_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_demo?: boolean
          organization_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          error_message: string | null
          id: string
          inputs: Json
          is_demo: boolean
          name: string
          organization_id: string
          output_url: string | null
          status: Database["public"]["Enums"]["video_status"]
          template: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          error_message?: string | null
          id?: string
          inputs?: Json
          is_demo?: boolean
          name: string
          organization_id: string
          output_url?: string | null
          status?: Database["public"]["Enums"]["video_status"]
          template: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          error_message?: string | null
          id?: string
          inputs?: Json
          is_demo?: boolean
          name?: string
          organization_id?: string
          output_url?: string | null
          status?: Database["public"]["Enums"]["video_status"]
          template?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_id: { Args: never; Returns: string }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      approve_team_member: {
        Args: { p_user_id: string; p_role: Database["public"]["Enums"]["user_role"] }
        Returns: undefined
      }
    }
    Enums: {
      billing_cycle: "monthly" | "quarterly" | "annual"
      customer_type:
        | "education"
        | "healthcare"
        | "government"
        | "corporate"
        | "other"
      invoice_status: "paid" | "pending" | "failed"
      lead_source: "website" | "meta" | "linkedin" | "referral" | "other"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "won"
        | "lost"
      opportunity_status:
        | "identified"
        | "contacted"
        | "proposed"
        | "won"
        | "dismissed"
      opportunity_type: "upsell" | "cross_sell"
      plan_category: "erp" | "marketing"
      post_mode: "auto" | "plan_only"
      post_status: "draft" | "scheduled" | "posted" | "failed"
      social_platform: "facebook" | "instagram" | "linkedin" | "twitter"
      subscription_status: "active" | "paused" | "cancelled" | "past_due"
      task_priority: "P0" | "P1" | "P2"
      task_status: "todo" | "in_progress" | "done"
      user_role: "admin" | "sales" | "marketing" | "finance"
      user_status: "pending" | "active"
      video_status: "draft" | "pending" | "rendering" | "rendered" | "failed"
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
