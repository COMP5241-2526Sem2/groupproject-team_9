import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ldvlktufqnenexsceqbf.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkdmxrdHVmcW5lbmV4c2NlcWJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjU2MzcsImV4cCI6MjA4OTA0MTYzN30.8uFzrHpwFGW4iDJn-E9QVrxtN-5fFuk6DMDcZquIt30';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
