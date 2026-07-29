import { getFixedRate, DepositCurrency } from './rates';

// Минимальная сумма пополнения в рублях — только у USDT есть смысл
// (нужно покрыть комиссию + иметь смысл возиться с TRX на газ для свипа).
const MIN_AMOUNT_RUB: Record<DepositCurrency, number> = {
  USDT_TRC20: 3000,
  TRX: 10,
  TON: 10,
};

// Фиксированная комиссия сети — добавляется СВЕРХ суммы, которая
// зачислится на баланс: пользователь отправляет чуть больше, баланс
// пополняется ровно на amountRub, а комиссия покрывает твои расходы на
// перевод USDT (TRX на газ для свипа), стандартную комиссию TRX и т.д.
const FLAT_COMMISSION: Record<DepositCurrency, number> = {
  USDT_TRC20: 3, // покрывает TRX-газ на свип USDT
  TRX: 1,        // стандартная комиссия сети TRON
  TON: 0,        // комиссия TON пренебрежимо мала — не берём
};

export interface PricingResult {
  rate: number;
  minAmountRub: number;
  grossAmountCrypto: number;       // сколько крипты соответствует amountRub по курсу
  commissionCrypto: number;        // фиксированная комиссия сверху
  expectedAmountCrypto: number;    // gross + commission — именно столько должен прислать пользователь
}

export async function calculatePricing(currency: DepositCurrency, amountRub: number): Promise<PricingResult> {
  const rate = await getFixedRate(currency);
  const grossAmountCrypto = amountRub / rate;
  const commissionCrypto = FLAT_COMMISSION[currency];
  return {
    rate,
    minAmountRub: MIN_AMOUNT_RUB[currency],
    grossAmountCrypto,
    commissionCrypto,
    expectedAmountCrypto: grossAmountCrypto + commissionCrypto,
  };
}

export function getMinAmountRub(currency: DepositCurrency): number {
  return MIN_AMOUNT_RUB[currency];
}
