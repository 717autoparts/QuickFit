import { createClient } from '@supabase/supabase-js';
export const sb = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_KEY
);
