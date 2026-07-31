import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkInternalToken } from '@/lib/auth';
import { sweepDeposit } from '@/lib/sweep';

// Даём функции больше времени: свип USDT включает топ-ап газа + паузу
// на подтверждение + сам перевод токена, это может занять больше 10с.
export const config = {
  api: { bodyParser: true },
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }
  if (!checkInternalToken(req)) {
    return res.status(401).json({ error: 'Неверный или отсутствующий x-internal-token' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Сервер не настроен (Supabase)' });
  }

  const depositId = Number(req.body?.depositId);
  if (!depositId) {
    return res.status(400).json({ error: 'depositId обязателен' });
  }

  const { data: deposit, error } = await supabaseAdmin
    .from('deposits')
    .select('*')
    .eq('id', depositId)
    .maybeSingle();

  if (error || !deposit) {
    return res.status(404).json({ error: 'Депозит не найден' });
  }

  const result = await sweepDeposit(deposit);
  return res.status(result.swept ? 200 : 500).json(result);
}
