import { createClient } from '@supabase/supabase-js'

// El secreto está en las comillas '' que envuelven los datos
const supabaseUrl = 'https://rqtdnapngdqhnewzdwzo.supabase.co'
const supabaseKey = 'sb_publishable_8SssJqi3R0lZfv2goWaTvw_fhsOClWx'

export const supabase = createClient(supabaseUrl, supabaseKey)