import { createClient } from '@supabase/supabase-js'

const supabaseUrl=import.meta.env.VITE_SUPABASE_URL||'https://spbmkixnldxnttcmutaq.supabase.co'
const supabaseKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_GYuUJCkJ90ZIvv2Lz5JmNQ_DplrXTdA'

export const supabase=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
