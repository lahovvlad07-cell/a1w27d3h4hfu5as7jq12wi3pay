import { supabaseAdmin } from './supabaseAdmin';
import { checkTronIncoming, checkTonIncoming } from './blockchain';
import { checkCryptoBotInvoice } from './providers/cryptobot';
import { checkXRocketInvoice } from './providers/xrocket';
import { DEPOSIT_EXPIRY_MINUTES } from './depositExpiry';
import { sweepDeposit } from './sweep';

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
 * ВАЖНО: раньше просрочку (`expired`) проставлял только worker.ts по
 * cron — если cron-job.org не настроен или перестал стучаться, депозит
 * молча вис в pending вечно (клиент при этом мог визуально показывать
 * "истёк" по локальному таймеру, но в базе статус не менялся). Теперь
 * сама verifyDeposit() тоже проверяет возраст депозита и просрочивает
 * его при любом вызове — то есть это работает даже если воркер вообще
 * не запущен, просто с задержкой до следующего нажатия "Проверить".
 *
 * Идемпотентно: если депозит уже не pending — просто возвращает текущий
 * статус, повторно блокчейн не дёргает и баланс повторно не начисляет.
 */
export async function verifyDeposit(deposit: any): Promise<VerifyResult> {
  if (!supabaseAdmin) return { status: 'pending', error: 'Supabase не инициализирован' };

  if (deposit.status !== 'pending') {
    return { status: deposit.status, alreadyProcessed: true };
  }
  const isInvoiceBased = deposit.currency === 'CRYPTOBOT' || deposit.currency === 'XROCKET';
  if (!isInvoiceBased && !deposit.address) {
    return { status: 'pending', error: 'У депозита ещё не сгенерирован адрес' };
  }
  if (isInvoiceBased && !deposit.invoice_id) {
    return { status: 'pending', error: 'У депозита ещё не создан инвойс' };
  }

  const ageMs = Date.now() - new Date(deposit.created_at).getTime();
  if (ageMs > DEPOSIT_EXPIRY_MINUTES * 60 * 1000) {
    // Атомарно, с тем же паттерном .eq('status','pending'), что и ниже
    // при confirmed — если воркер и кнопка "Проверить" одновременно
    // наткнулись на один и тот же просроченный депозит, второй вызов
    // просто не найдёт строку для обновления.
    const { data: expiredRow } = await supabaseAdmin
      .from('deposits')
      .update({ status: 'expired' })
      .eq('id', deposit.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    return { status: 'expired', alreadyProcessed: !expiredRow };
  }

  let result: { found: boolean; txHash?: string; receivedAmount?: number | null; underpaid?: boolean };

  if (deposit.currency === 'TON') {
    result = await checkTonIncoming(deposit.address, Number(deposit.expected_amount_crypto));
  } else if (deposit.currency === 'CRYPTOBOT' || deposit.currency === 'XROCKET') {
    // Инвойс либо оплачен целиком, либо нет — частичной оплаты у этих
    // провайдеров не бывает (в отличие от блокчейн-адресов, куда в
    // теории можно прислать любую сумму), поэтому underpaid всегда false.
    const status = deposit.currency === 'CRYPTOBOT'
      ? await checkCryptoBotInvoice(deposit.invoice_id)
      : await checkXRocketInvoice(deposit.invoice_id);
    result = {
      found: status.status === 'paid',
      txHash: deposit.invoice_id, // у инвойсов нет отдельного хэша транзакции — используем id инвойса
      receivedAmount: status.paidAmount ?? null,
    };
  } else {
    result = await checkTronIncoming(deposit.address, deposit.currency === 'USDT_TRC20', Number(deposit.expected_amount_crypto));
  }

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

  // Баланс уже начислен — теперь пробуем сразу увести деньги с
  // одноразового адреса на казначейский кошелёк. Делаем это здесь же
  // (синхронно), а не "в фоне без ожидания", чтобы неудачный свип не
  // потерялся молча — но ошибка свипа НИКОГДА не влияет на статус
  // 'confirmed', который уже вернулся пользователю: баланс начислен,
  // депозит подтверждён, а свип — это уже внутренняя операционная
  // задача, которую при необходимости можно повторить вручную из
  // дашборда (см. pages/api/payments/sweep.ts).
  const updatedDeposit = { ...deposit, status: 'confirmed' };
  const sweepResult = await sweepDeposit(updatedDeposit).catch((e) => ({ swept: false, error: e.message || String(e) }));
  if (!sweepResult.swept) {
    console.error(`[verifyDeposit] депозит ${deposit.id} подтверждён, но свип не удался:`, sweepResult.error);
  }

  return {
    status: 'confirmed',
    txHash: result.txHash,
    receivedAmount: result.receivedAmount,
  };
}
