import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveAuthenticatedUser } from '@/lib/auth';
import { verifyDeposit } from '@/lib/verifyDeposit';
import { applyCors } from '@/lib/cors';

/**
 * Проверяет конкретный депозит (по id) на предмет входящего платежа.
 * Вызывается кнопкой "Проверить" из Mini App — принудительно, сразу же,
 * в отличие от фонового воркера (см. worker.ts), который делает то же
 * самое раз в минуту для ВСЕХ pending-депозитов сразу, даже если Mini
 * App закрыт. Сама логика подтверждения — в lib/verifyDeposit.ts,
 * общая для обоих путей.
 */
// Даём функции больше времени на холодный старт (загрузка tronweb/
// bip39/bip32/tiny-secp256k1(WASM) + сетевые запросы к TronGrid/TonCenter/
// Supabase могут не уложиться в дефолтные 10с на Hobby-плане, особенно
// на первом вызове после простоя — из-за этого мог падать "Failed to
// fetch" на клиенте без какого-либо кода ошибки. Подними ещё выше, если
// план это позволяет и проблема повторится.
export const config = {
  api: { bodyParser: true },
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Сервер не настроен (Supabase)' });
  }

  const auth = resolveAuthenticatedUser(req);
  if (!auth.ok || !auth.userId) {
    return res.status(401).json({ error: auth.error || 'Не удалось подтвердить пользователя' });
  }

  const depositId = Number(req.body?.depositId);
  if (!depositId) {
    return res.status(400).json({ error: 'depositId обязателен' });
  }

  const { data: deposit, error: fetchError } = await supabaseAdmin
    .from('deposits')
    .select('*')
    .eq('id', depositId)
    .maybeSingle();

  if (fetchError || !deposit) {
    return res.status(404).json({ error: 'Депозит не найден' });
  }

  // Проверяем, что чужой депозит не проверяют под чужим user_id —
  // кроме случая внутреннего токена (cron/дашборд), у которого
  // доступ ко всем депозитам уже подразумевается доверенным.
  if (!auth.viaInternalToken && deposit.user_id !== auth.userId) {
    return res.status(403).json({ error: 'Этот депозит принадлежит другому пользователю' });
  }

  try {
    const result = await verifyDeposit(deposit);
    if (result.error && result.status === 'pending') {
      return res.status(500).json({ error: result.error });
    }
    return res.status(200).json({
      status: result.status,
      found: result.found,
      underpaid: result.underpaid,
      receivedAmount: result.receivedAmount,
      txHash: result.txHash,
      alreadyProcessed: result.alreadyProcessed,
      creditedRub: result.status === 'confirmed' ? deposit.amount_rub : undefined,
      error: result.status === 'confirmed' ? result.error : undefined, // ошибка начисления баланса после confirmed
    });
  } catch (e: any) {
    console.error('[check-payment] error:', e);
    return res.status(500).json({ error: e.message || 'Ошибка проверки платежа' });
  }
}
