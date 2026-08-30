// Config do backend Supabase da mesa. A publishable key é segura para expor no
// front-end (é o que o Supabase chama de "anon/publishable key") — o acesso real
// é controlado pelas policies de RLS no banco.
const SUPABASE_URL = "https://czejeavttamzmpvoputb.supabase.co";
const SUPABASE_KEY = "sb_publishable_snLsceUFPNSoEh9NzWtY1g_7c-oHaRL";

const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
