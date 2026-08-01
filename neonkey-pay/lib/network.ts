// ===== ПЕРЕКЛЮЧЕНИЕ MAINNET / TESTNET =====
//
// Раньше эндпоинты TronGrid/TonCenter были захардкожены на mainnet прямо
// в коде — чтобы прогнать тестовый цикл на Nile/TON-testnet, приходилось
// руками лезть в несколько файлов и менять URL, а потом не забыть вернуть
// обратно перед деплоем с реальными деньгами (см. README, там же
// предупреждение про этот риск). Теперь это один переключатель в env:
//
//   TRON_NETWORK=nile   — тестовая сеть TRON (тестовые TRX/USDT, кран: https://nileex.io/join/getJoinPage)
//   TRON_NETWORK=mainnet (или не задано) — боевая сеть
//
//   TON_NETWORK=testnet — тестовая сеть TON (тестовый TON, кран: https://t.me/testgiver_ton_bot)
//   TON_NETWORK=mainnet (или не задано) — боевая сеть
//
// Тестнет и мейннет — это ПОЛНОСТЬЮ разные балансы и разные тестовые
// контракты токенов, даже если адрес кошелька выглядит одинаково (для
// TRON — буквально один и тот же адрес на mainnet и Nile, но баланс на
// нём независим). Реальные деньги на тестнете не появятся сами собой.
export function isTronTestnet(): boolean {
  return (process.env.TRON_NETWORK || 'mainnet').toLowerCase() === 'nile';
}

export function tronFullHost(): string {
  return isTronTestnet() ? 'https://nile.trongrid.io' : 'https://api.trongrid.io';
}

// Тестовый USDT-контракт на Nile — не тот же адрес, что на mainnet.
// Актуальный адрес и кран (2000 TRX + 1000 тестовых USDT в сутки на
// адрес) см. на https://nileex.io/join/getJoinPage — если Tron Foundation
// когда-нибудь поменяет тестовый контракт, обнови значение по умолчанию
// ниже или просто задай свой через USDT_TRC20_CONTRACT в .env.
const MAINNET_USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const NILE_USDT_TRC20_CONTRACT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

export function usdtTrc20Contract(): string {
  if (process.env.USDT_TRC20_CONTRACT) return process.env.USDT_TRC20_CONTRACT;
  return isTronTestnet() ? NILE_USDT_TRC20_CONTRACT : MAINNET_USDT_TRC20_CONTRACT;
}

export function isTonTestnet(): boolean {
  return (process.env.TON_NETWORK || 'mainnet').toLowerCase() === 'testnet';
}

export function tonCenterBase(): string {
  return isTonTestnet() ? 'https://testnet.toncenter.com' : 'https://toncenter.com';
}
