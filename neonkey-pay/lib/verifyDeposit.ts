import { supabaseAdmin } from './supabaseAdmin';
import { checkTronIncoming, checkTonIncoming } from './blockchain';

export interface VerifyResult {
  status: 'pending' | 'confirmed' | 'expired';
  found?: boolean;
  underpaid?: boolean;
  receivedAmount?: number | null;
  txHash?: string;
  alreadyProcessed?: boolean;
  error?: string;
}

/**
 * Проверяет один pending-депозит по блокчейну и, если платёж найден,
 * атомарно переводит его в confirmed и начисляет баланс. Используется
 * и кнопкой "Проверить" (pages/api/payments/check.ts, немедленно, по
 * одному депозиту), и фоновым воркером (pages/api/payments/worker.ts,
 * раз в минуту, по всем pending сразу) — чтобы логика подтверждения
 * платежа существовала в одном месте и не могла разъехаться.
 *
 * Идемпотентно: если депозит уже не pending — просто возвращает текущий
 * статус, повторно блокчейн не дёргает и баланс повторно не начисляет.
 */
export async function verifyDeposit(deposit: any): Promise<VerifyResult> {
  if (!supabaseAdmin) return { status: 'pending', error: 'Supabase не инициализирован' };

  if (deposit.status !== 'pending') {
    return { status: deposit.status, alreadyProcessed: true };
  }
  if (!deposit.address) {
    return { status: 'pending', error: 'У депозита ещё не сгенерирован адрес' };
  }

  const result = deposit.currency === 'TON'
    ? await checkTonIncoming(deposit.address, Number(deposit.expected_amount_crypto))
    : await checkTronIncoming(deposit.address, deposit.currency === 'USDT_TRC20', Number(deposit.expected_amount_crypto));

  if (!result.found) {
    return {
      status: 'pending',
      found: false,
      underpaid: result.underpaid || false,
      receivedAmount: result.receivedAmount ?? null,
    };
  }

  // Атомарно переводим депозит в confirmed, но ТОЛЬКО если он всё ещё
  // pending — .eq('status', 'pending') здесь защищает от гонки, если
  // ручная кнопка и воркер сработали одновременно на один и тот же
  // депозит: второй вызов просто не найдёт строку для обновления.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('deposits')
    .update({ status: 'confirmed', tx_hash: result.txHash, confirmed_at: new Date().toISOString() })
    .eq('id', deposit.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (updateError) {
    return { status: 'pending', error: updateError.message };
  }
  if (!updated) {
    // Кто-то другой (параллельный вызов) уже успел подтвердить этот
    // депозит между нашим select и update — баланс уже начислен им.
    return { status: 'confirmed', alreadyProcessed: true };
  }

  const { error: creditError } = await supabaseAdmin.rpc('increment_balance', {
    p_user_id: deposit.user_id,
    p_amount: Number(deposit.amount_rub),
  });

  if (creditError) {
    // Депозит уже помечен confirmed, но баланс не начислен — это надо
    // разрулить руками (см. tx_hash в ответе), не откатываем статус
    // автоматически, чтобы не потерять факт найденного платежа.
    console.error('[verifyDeposit] баланс не начислен:', creditError);
    return {
      status: 'confirmed',
      error: `Платёж найден (tx ${result.txHash}), но начислить баланс не удалось: ${creditError.message}. Начисли вручную.`,
      txHash: result.txHash,
    };
  }

  return {
    status: 'confirmed',
    txHash: result.txHash,
    receivedAmount: result.receivedAmount,
  };
}
