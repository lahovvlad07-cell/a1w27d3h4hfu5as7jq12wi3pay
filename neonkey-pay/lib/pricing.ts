import { getDepositSettings, DepositCurrency } from './rates';

export interface PricingResult {
  rate: number;
  minAmountRub: number;
  grossAmountCrypto: number;       // сколько крипты соответствует amountRub по курсу (это и зачисляется на баланс)
  commissionCrypto: number;        // комиссия сверху, в пересчёте на крипту по тому же курсу
  commissionRub: number;           // та же комиссия в рублях — для показа в интерфейсе
  expectedAmountCrypto: number;    // gross + commission — именно столько должен прислать пользователь
}

/**
 * Комиссия и минималка теперь настраиваются из админки основного Mini App
 * (таблица settings, ключи commission_type_<currency>/commission_value_<currency>/
 * min_<currency> — см. lib/rates.ts) вместо хардкода. Комиссия считается
 * от суммы пополнения в рублях (фиксированная ₽ или % от amountRub), затем
 * переводится в крипту по тому же курсу — так пользователь всегда видит и
 * платит в одной валюте, а на баланс зачисляется ровно amountRub, без
 * округлений из-за курса.
 */
export async function calculatePricing(currency: DepositCurrency, amountRub: number): Promise<PricingResult> {
  const settings = await getDepositSettings(currency);
  const { rate, commissionType, commissionValue, minAmountRub } = settings;

  const commissionRub = commissionType === 1 ? amountRub * (commissionValue / 100) : commissionValue;
  const grossAmountCrypto = amountRub / rate;
  const commissionCrypto = commissionRub / rate;

  return {
    rate,
    minAmountRub,
    grossAmountCrypto,
    commissionCrypto,
    commissionRub,
    expectedAmountCrypto: grossAmountCrypto + commissionCrypto,
  };
}

export async function getMinAmountRub(currency: DepositCurrency): Promise<number> {
  return (await getDepositSettings(currency)).minAmountRub;
}
