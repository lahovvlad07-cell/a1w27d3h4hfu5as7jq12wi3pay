import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveAuthenticatedUser } from '@/lib/auth';
import { calculatePricing } from '@/lib/pricing';
import { DepositCurrency } from '@/lib/rates';
import { deriveTronAccount } from '@/lib/wallets/tron';
import { deriveTonAccount } from '@/lib/wallets/ton';
import { DEPOSIT_EXPIRY_MINUTES, expireStaleDeposits } from '@/lib/depositExpiry';
import { applyCors } from '@/lib/cors';

const VALID_CURRENCIES: DepositCurrency[] = ['USDT_TRC20', 'TRX', 'TON'];

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
  const userId = auth.userId;

  // Побочным эффектом чистим старые "зависшие" pending-депозиты (см.
  // lib/depositExpiry.ts) — не блокирует создание нового платежа, ошибка
  // здесь никогда не мешает основному запросу.
  await expireStaleDeposits();

  const { currency, amountRub } = req.body || {};
  if (!VALID_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `currency должен быть одним из: ${VALID_CURRENCIES.join(', ')}` });
  }
  const amount = Number(amountRub);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'amountRub должен быть положительным числом' });
  }

  try {
    const pricing = await calculatePricing(currency, amount);
    if (amount < pricing.minAmountRub) {
      return res.status(400).json({ error: `Минимальная сумма для ${currency} — ${pricing.minAmountRub} ₽` });
    }

    // Шаг 1: создаём строку без адреса, чтобы получить id (он же — индекс деривации).
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('deposits')
      .insert({
        user_id: userId,
        currency,
        amount_rub: amount,
        rate_used: pricing.rate,
        commission_crypto: pricing.commissionCrypto,
        gross_amount_crypto: pricing.grossAmountCrypto,
        expected_amount_crypto: pricing.expectedAmountCrypto,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message || 'Не удалось создать запись депозита');
    }
    const depositId = inserted.id as number;

    // Шаг 2: по id выводим адрес и сохраняем его в ту же строку.
    let address: string;
    let walletId: number | null = null;

    if (currency === 'TON') {
      const account = await deriveTonAccount(depositId);
      address = account.address;
      walletId = account.walletId;
    } else {
      // USDT_TRC20 и TRX — один и тот же TRON-адрес
      const account = deriveTronAccount(depositId);
      address = account.address;
    }

    const { error: updateError } = await supabaseAdmin
      .from('deposits')
      .update({ address, wallet_id: walletId })
      .eq('id', depositId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return res.status(200).json({
      depositId,
      address,
      currency,
      amountRub: amount,
      rateUsed: pricing.rate,
      grossAmountCrypto: pricing.grossAmountCrypto,
      commissionCrypto: pricing.commissionCrypto,
      commissionRub: pricing.commissionRub,
      expectedAmountCrypto: pricing.expectedAmountCrypto,
      expiresInMinutes: DEPOSIT_EXPIRY_MINUTES,
      viaInternalToken: auth.viaInternalToken || false,
    });
  } catch (e: any) {
    console.error('[create-payment] error:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
