import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Не бросаем на этапе импорта модуля (ломало бы сборку/dev без env),
  // но каждый API-роут обязан проверить наличие клиента перед использованием.
  console.warn('[supabaseAdmin] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы');
}

export const supabaseAdmin = url && serviceKey
  ? createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
