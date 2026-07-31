import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkInternalToken } from '@/lib/auth';

// Даём функции больше времени на холодный старт (загрузка tronweb/
// bip39/bip32/tiny-secp256k1(WASM) + сетевые запросы к TronGrid/TonCenter/
// Supabase могут не уложиться в дефолтные 10с на Hobby-плане, особенно
// на первом вызове после простоя — из-за этого мог падать "Failed to
// fetch" на клиенте без какого-либо кода ошибки. Подними ещё выше, если
// план это позволяет и проблема повторится.
export const config = {
  api: { bodyParser: true },
  maxDuration: 30,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }
  if (!checkInternalToken(req)) {
    return res.status(401).json({ error: 'Неверный или отсутствующий x-internal-token' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Сервер не настроен (Supabase)' });
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const { data, error } = await supabaseAdmin
    .from('deposits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ deposits: data || [] });
}
