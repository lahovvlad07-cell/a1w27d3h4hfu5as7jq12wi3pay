import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveAuthenticatedUser } from '@/lib/auth';
import { calculatePricing } from '@/lib/pricing';
import { DepositCurrency } from '@/lib/rates';
import { deriveTronAccount } from '@/lib/wallets/tron';
import { deriveTonAccount } from '@/lib/wallets/ton';

const VALID_CURRENCIES: DepositCurrency[] = ['USDT_TRC20', 'TRX', 'TON'];

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
  const userId = auth.userId;

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
      expectedAmountCrypto: pricing.expectedAmountCrypto,
      viaInternalToken: auth.viaInternalToken || false,
    });
  } catch (e: any) {
    console.error('[create-payment] error:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
