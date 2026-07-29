import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveAuthenticatedUser } from '@/lib/auth';
import { checkTronIncoming, checkTonIncoming } from '@/lib/blockchain';

/**
 * Проверяет конкретный депозит (по id) на предмет входящего платежа.
 * Вызывается либо кнопкой "Проверить" из Mini App (после того как
 * пользователь нажал "Я оплатил"), либо позже — фоновым cron-воркером
 * для всех pending-депозитов сразу (см. README, шаг 2).
 *
 * Идемпотентно: если депозит уже не pending — просто возвращает текущий
 * статус, повторно блокчейн не дёргает и баланс повторно не начисляет.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  if (deposit.status !== 'pending') {
    return res.status(200).json({ status: deposit.status, alreadyProcessed: true });
  }
  if (!deposit.address) {
    return res.status(409).json({ error: 'У депозита ещё не сгенерирован адрес' });
  }

  try {
    const result = deposit.currency === 'TON'
      ? await checkTonIncoming(deposit.address, Number(deposit.expected_amount_crypto))
      : await checkTronIncoming(deposit.address, deposit.currency === 'USDT_TRC20', Number(deposit.expected_amount_crypto));

    if (!result.found) {
      return res.status(200).json({
        status: 'pending',
        found: false,
        underpaid: result.underpaid || false,
        receivedAmount: result.receivedAmount ?? null,
      });
    }

    // Атомарно переводим депозит в confirmed, но ТОЛЬКО если он всё ещё
    // pending — .eq('status', 'pending') здесь защищает от гонки, если
    // ручная кнопка и cron-воркер сработали одновременно на один и тот
    // же депозит: второй вызов просто не найдёт строку для обновления.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('deposits')
      .update({ status: 'confirmed', tx_hash: result.txHash, confirmed_at: new Date().toISOString() })
      .eq('id', depositId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }
    if (!updated) {
      // Кто-то другой (параллельный вызов) уже успел подтвердить этот
      // депозит между нашим select и update — баланс уже начислен им,
      // начислять второй раз не нужно.
      return res.status(200).json({ status: 'confirmed', alreadyProcessed: true });
    }

    const { error: creditError } = await supabaseAdmin.rpc('increment_balance', {
      p_user_id: deposit.user_id,
      p_amount: Number(deposit.amount_rub),
    });

    if (creditError) {
      // Депозит уже помечен confirmed, но баланс не начислен — это надо
      // разрулить руками (см. tx_hash в ответе), не откатываем статус
      // автоматически, чтобы не потерять факт найденного платежа.
      console.error('[check-payment] баланс не начислен:', creditError);
      return res.status(500).json({
        error: `Платёж найден (tx ${result.txHash}), но начислить баланс не удалось: ${creditError.message}. Начисли вручную.`,
        txHash: result.txHash,
      });
    }

    return res.status(200).json({
      status: 'confirmed',
      txHash: result.txHash,
      receivedAmount: result.receivedAmount,
      creditedRub: deposit.amount_rub,
    });
  } catch (e: any) {
    console.error('[check-payment] error:', e);
    return res.status(500).json({ error: e.message || 'Ошибка проверки платежа' });
  }
}
