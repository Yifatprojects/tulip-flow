import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Recovery tokens are exchanged manually on /reset-password (avoids races with stale sessions).
    detectSessionInUrl: false,
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
  },
})
