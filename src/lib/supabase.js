import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://owswdfnjajscjzwkohaj.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3dkZm5qYWpzY2p6d2tvaGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTg5ODQsImV4cCI6MjEwMDk5NDk4NH0.Rp2bKOtjn_763Y2h7xsqlqZLDe86NSFXaspc2AJccP8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
