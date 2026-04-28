// Auto-generated database types from Supabase schema
// Run: supabase gen types typescript --project-id YOUR_PROJECT > src/lib/database.types.ts
// Or use this manually-curated version

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          investor_id: string | null
          role: 'investor' | 'bank_staff' | 'admin' | 'auditor'
          status: 'pending' | 'active' | 'suspended' | 'closed'
          full_name: string
          date_of_birth: string | null
          phone: string
          email: string
          address: string | null
          region: string | null
          id_type: string | null
          id_number: string | null
          kyc_verified: boolean
          totp_enabled: boolean
          sms_2fa_enabled: boolean
          next_of_kin_name: string | null
          next_of_kin_phone: string | null
          next_of_kin_relation: string | null
          total_shares: number
          total_invested: number
          total_dividends_earned: number
          last_login_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      share_classes: {
        Row: {
          id: string
          code: string
          name: string
          description: string | null
          face_value: number
          current_price: number
          minimum_units: number
          dividend_rate: number | null
          dividend_frequency: string
          total_shares_authorized: number
          total_shares_issued: number
          investor_count: number
          is_available: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['share_classes']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['share_classes']['Insert']>
      }
      share_holdings: {
        Row: {
          id: string
          investor_id: string
          share_class_id: string
          total_units: number
          total_amount_invested: number
          average_cost_per_unit: number | null
          current_value: number | null
          certificate_number: string | null
          certificate_issued_at: string | null
          certificate_url: string | null
          status: string
          first_purchase_at: string | null
          last_updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['share_holdings']['Row'], 'last_updated_at'>
        Update: Partial<Database['public']['Tables']['share_holdings']['Insert']>
      }
      share_transactions: {
        Row: {
          id: string
          reference: string
          investor_id: string
          share_class_id: string
          holding_id: string | null
          transaction_type: string
          units: number
          price_per_unit: number
          gross_amount: number
          charges: number
          net_amount: number
          processing_fee: number
          platform_fee: number
          vat: number
          payment_id: string | null
          payment_status: string
          payment_channel: string | null
          approval_status: string
          approved_by: string | null
          approved_at: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['share_transactions']['Row'], 'reference' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['share_transactions']['Insert']>
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          message: string
          data: Json | null
          read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['notifications']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
  }
}
