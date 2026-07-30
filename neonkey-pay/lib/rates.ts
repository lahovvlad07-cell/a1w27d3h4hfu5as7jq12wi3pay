import { supabaseAdmin } from './supabaseAdmin';

export type DepositCurrency = 'USDT_TRC20' | 'TRX' | 'TON';

const RATE_KEY_BY_CURRENCY: Record<DepositCurrency, string> = {
  USDT_TRC20: 'usdt_rate',
  TRX: 'trx_rate',
  TON: 'ton_rate',
};

// Суффикс ключей settings для комиссии/минималки — совпадает с тем, что
// использует admin.js основного Mini App (см. webapp/js/config.js
// DEFAULT_SETTINGS: commission_type_usdt / commission_value_usdt / min_usdt и т.д.)
const SETTINGS_SUFFIX_BY_CURRENCY: Record<DepositCurrency, string> = {
  USDT_TRC20: 'usdt',
  TRX: 'trx',
  TON: 'ton',
};

// Дефолты — используются только если в таблице settings ещё нет
// соответствующей строки (например, админ ни разу не открывал форму
// комиссии). Совпадают с DEFAULT_SETTINGS в основном вебаппе.
const FALLBACK: Record<DepositCurrency, { rate: number; commissionType: 0 | 1; commissionValue: number; minAmountRub: number }> = {
  USDT_TRC20: { rate: 90, commissionType: 0, commissionValue: 250, minAmountRub: 3000 },
  TRX: { rate: 15, commissionType: 0, commissionValue: 15, minAmountRub: 10 },
  TON: { rate: 700, commissionType: 0, commissionValue: 0, minAmountRub: 10 },
};

export interface DepositSettings {
  rate: number;
  commissionType: 0 | 1; // 0 = фиксированная (₽), 1 = процент от суммы
  commissionValue: number;
  minAmountRub: number;
}

/**
 * Курс, комиссия и минималка берутся из той же таблицы `settings`, что
 * редактируется в админке основного Mini App — значит менять их можно
 * прямо оттуда, не трогая этот сервис отдельно. Читаем все нужные ключи
 * одним запросом (не по одному на поле), чтобы не плодить round-trips.
 */
export async function getDepositSettings(currency: DepositCurrency): Promise<DepositSettings> {
  if (!supabaseAdmin) throw new Error('Supabase не инициализирован');
  const suffix = SETTINGS_SUFFIX_BY_CURRENCY[currency];
  const keys = [RATE_KEY_BY_CURRENCY[currency], `commission_type_${suffix}`, `commission_value_${suffix}`, `min_${suffix}`];

  const { data, error } = await supabaseAdmin.from('settings').select('key, value').in('key', keys);
  if (error) {
    throw new Error(`Не удалось получить настройки пополнения (${suffix}): ${error.message}`);
  }

  const map: Record<string, number> = {};
  (data || []).forEach((row) => { map[row.key] = Number(row.value); });
  const fb = FALLBACK[currency];

  const rate = map[RATE_KEY_BY_CURRENCY[currency]];
  if (!rate || rate <= 0) {
    throw new Error(`Курс "${RATE_KEY_BY_CURRENCY[currency]}" не задан или некорректен в settings`);
  }

  const commissionType = (map[`commission_type_${suffix}`] === 1 ? 1 : (map[`commission_type_${suffix}`] === 0 ? 0 : fb.commissionType)) as 0 | 1;
  const commissionValue = map[`commission_value_${suffix}`] ?? fb.commissionValue;
  const minAmountRub = map[`min_${suffix}`] ?? fb.minAmountRub;

  return { rate, commissionType, commissionValue, minAmountRub };
}

/** Оставлено для обратной совместимости — только курс, без комиссии/минималки. */
export async function getFixedRate(currency: DepositCurrency): Promise<number> {
  return (await getDepositSettings(currency)).rate;
}
