import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Public project URL + anon key. The anon key is safe to ship in the app —
// Row-Level Security (schema.sql) is what actually protects the data.
// Fill these in app.json → expo.extra (supabaseUrl / supabaseAnonKey).
// Defaults are the public project URL + publishable key (safe to ship; RLS is
// what protects the data). app.json → extra can override them per build.
const DEFAULT_URL = 'https://accxqbtukprszgwroorq.supabase.co';
const DEFAULT_ANON = 'sb_publishable_RPyqdASQP1dbyc_8OF6oYA_lSEMhOIO';

const extra = Constants.expoConfig?.extra || Constants.manifest?.extra || {};
const SUPABASE_URL = extra.supabaseUrl || DEFAULT_URL;
const SUPABASE_ANON_KEY = extra.supabaseAnonKey || DEFAULT_ANON;

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// Create the client even if unconfigured so imports don't crash; calls will
// simply fail until credentials are set. `isSupabaseConfigured` gates usage.
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
