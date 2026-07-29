import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateTelegramInitData } from '@/lib/telegramAuth';
import { getFixedRate, DepositCurrency } from '@/lib/rates';
import { deriveTronAccount } from '@/lib/wallets/tron';
import { deriveTonAccount } from '@/lib/wallets/ton';

const VALID_CURRENCIES: DepositCurrency[] = ['USDT_TRC20', 'TRX', 'TON'];
const MIN_AMOUNT_RUB = 10;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Сервер не настроен (Supabase)' });
  }

  const { initData, currency, amountRub } = req.body || {};

  // ВАЖНО: user_id берём только из провалидированной initData, а не из
  // тела запроса — иначе кто угодно мог бы прислать чужой user_id и
  // получить пополнение на чужой счёт.
  const auth = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN || '');
  if (!auth.ok || !auth.user) {
    return res.status(401).json({ error: auth.error || 'Не удалось подтвердить пользователя Telegram' });
  }
  const userId = auth.user.id;

  if (!VALID_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `currency должен быть одним из: ${VALID_CURRENCIES.join(', ')}` });
  }
  const amount = Number(amountRub);
  if (!amount || amount < MIN_AMOUNT_RUB) {
    return res.status(400).json({ error: `Минимальная сумма пополнения — ${MIN_AMOUNT_RUB} ₽` });
  }

  try {
    const rate = await getFixedRate(currency);
    const expectedAmountCrypto = amount / rate;

    // Шаг 1: создаём строку без адреса, чтобы получить id (он же — индекс деривации).
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('deposits')
      .insert({
        user_id: userId,
        currency,
        amount_rub: amount,
        rate_used: rate,
        expected_amount_crypto: expectedAmountCrypto,
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
      rateUsed: rate,
      expectedAmountCrypto,
    });
  } catch (e: any) {
    console.error('[create-payment] error:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
