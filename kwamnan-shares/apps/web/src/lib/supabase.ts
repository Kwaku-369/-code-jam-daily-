import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Untyped client — full Database typing is regenerated server-side once
// migrations are applied. Routes assert row shapes locally where needed.
export function createClient() {
  return createBrowserClient<any, any, any>(supabaseUrl, supabaseAnonKey)
}
