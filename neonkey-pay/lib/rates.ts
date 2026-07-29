import { supabaseAdmin } from './supabaseAdmin';

export type DepositCurrency = 'USDT_TRC20' | 'TRX' | 'TON';

const RATE_KEY_BY_CURRENCY: Record<DepositCurrency, string> = {
  USDT_TRC20: 'usdt_rate',
  TRX: 'trx_rate',
  TON: 'ton_rate',
};

/**
 * Курс берётся из той же таблицы `settings`, что редактируется в
 * админке основного Mini App (ключи usdt_rate/trx_rate/ton_rate) —
 * значит менять курс можно как обычно, из уже готовой админки, не
 * трогая этот сервис отдельно.
 */
export async function getFixedRate(currency: DepositCurrency): Promise<number> {
  if (!supabaseAdmin) throw new Error('Supabase не инициализирован');
  const key = RATE_KEY_BY_CURRENCY[currency];

  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) {
    throw new Error(`Не удалось получить курс "${key}" из таблицы settings: ${error?.message || 'нет строки'}`);
  }

  const rate = Number(data.value);
  if (!rate || rate <= 0) {
    throw new Error(`Курс "${key}" некорректен: ${data.value}`);
  }
  return rate;
}
