import { createClient } from '@supabase/supabase-js'

const directUrl='https://spbmkixnldxnttcmutaq.supabase.co'
const supabaseUrl=typeof window!=='undefined'?`${window.location.origin}/supabase`:directUrl
const supabaseKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_GYuUJCkJ90ZIvv2Lz5JmNQ_DplrXTdA'

export const supabase=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},realtime:{params:{eventsPerSecond:5}}})
