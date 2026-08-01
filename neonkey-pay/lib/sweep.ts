import { supabaseAdmin } from './supabaseAdmin';
import {
  deriveTronAccount,
  getMasterTronAccount,
  getTrxBalanceSun,
  getUsdtBalanceRaw,
  sendTrx,
  sendUsdt,
} from './wallets/tron';
import { getMasterTonAccount, sweepAllTon } from './wallets/ton';

// Резерв, который оставляем на самом одноразовом TRX-адресе при свипе
// нативного TRX (на случай, если комиссия спишется из присланной суммы,
// а не из отдельного bandwidth-лимита) — примерно 1.1 TRX.
const TRX_SWEEP_RESERVE_SUN = Number(process.env.TRX_SWEEP_RESERVE_SUN || 1_100_000);
// Сколько TRX подкидываем на одноразовый USDT-адрес, чтобы у него
// появился газ для перевода TRC-20 токена (сам адрес получал только
// USDT, поэтому TRX на нём почти наверняка 0). 20 TRX — заведомо с
// запасом для одного transfer(); излишек просто останется на адресе.
const TRX_GAS_TOPUP_SUN = Number(process.env.TRX_GAS_TOPUP_SUN || 20_000_000);

export interface SweepResult {
  swept: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Переводит подтверждённый депозит в 'swept' и уводит деньги с
 * одноразового адреса на казначейский кошелёк (index 0, см.
 * getMasterTronAccount/getMasterTonAccount). Вызывается автоматически
 * сразу после verifyDeposit() (см. verifyDeposit.ts), а также доступна
 * для ручного повтора из дашборда (pages/api/payments/sweep.ts) — на
 * случай, если автоматический свип не удался (не хватило TRX на газ,
 * сеть моргнула, и т.д.).
 *
 * Идемпотентно: если депозит не 'confirmed' — ничего не делает.
 *
 * ⚠️ ЭТО ДВИЖЕНИЕ РЕАЛЬНЫХ ДЕНЕГ. Прежде чем полагаться на этот код с
 * настоящими USDT/TRX/TON — обязательно прогони весь цикл (создание
 * адреса → оплата → verifyDeposit → sweepDeposit) на тестовых сетях
 * (TRON Nile, TON testnet), см. README.
 */
export async function sweepDeposit(deposit: any): Promise<SweepResult> {
  if (!supabaseAdmin) return { swept: false, error: 'Supabase не инициализирован' };
  if (deposit.status === 'swept') return { swept: true, txHash: deposit.sweep_tx_hash };
  if (deposit.status !== 'confirmed') {
    return { swept: false, error: `Депозит в статусе "${deposit.status}", свип возможен только из "confirmed"` };
  }

  try {
    let txHash: string;

    if (deposit.currency === 'CRYPTOBOT' || deposit.currency === 'XROCKET') {
      // Деньги уже лежат в кастодиальном балансе провайдера (CryptoBot/
      // xRocket) — в отличие от TRON/TON здесь нет одноразового адреса,
      // с которого нужно куда-то переводить средства. "Свип" тут просто
      // фиксирует финальный статус, реального перевода не происходит.
      // Вывод из самого CryptoBot/xRocket в рубли/другую крипту делается
      // вручную из соответствующего бота, это уже вне зоны этого сервиса.
      txHash = 'provider-custody';
    } else if (deposit.currency === 'TON') {
      const master = await getMasterTonAccount();
      const result = await sweepAllTon(deposit.id, master.address);
      txHash = result.label;
    } else if (deposit.currency === 'USDT_TRC20') {
      const account = deriveTronAccount(deposit.id);
      const master = getMasterTronAccount();

      // Газ (TRX) для перевода TRC-20 токена — у свежего адреса, на
      // который прислали только USDT, TRX почти наверняка 0.
      const trxBalance = await getTrxBalanceSun(account.address);
      if (trxBalance < TRX_GAS_TOPUP_SUN / 2) {
        await sendTrx(master.privateKeyHex, account.address, TRX_GAS_TOPUP_SUN);
        // Даём сети несколько секунд на подтверждение топ-апа, прежде
        // чем тратить его на перевод токена.
        await new Promise((r) => setTimeout(r, 6000));
      }

      const usdtRaw = await getUsdtBalanceRaw(account.address);
      if (usdtRaw <= 0n) {
        throw new Error('На адресе не найден баланс USDT для свипа');
      }
      txHash = await sendUsdt(account.privateKeyHex, master.address, usdtRaw);
      // Остаток TRX (то, что не потратилось на газ) намеренно не свипаем
      // отдельным шагом здесь — не усложняем один вызов; если останется
      // заметная сумма, её всегда можно увести вручную через дашборд
      // (тот же адрес детерминированно восстанавливается по deposit.id).
    } else {
      // TRX
      const account = deriveTronAccount(deposit.id);
      const master = getMasterTronAccount();
      const trxBalance = await getTrxBalanceSun(account.address);
      const amountToSend = trxBalance - TRX_SWEEP_RESERVE_SUN;
      if (amountToSend <= 0) {
        throw new Error(`Баланс TRX (${trxBalance} SUN) слишком мал для свипа с учётом резерва`);
      }
      txHash = await sendTrx(account.privateKeyHex, master.address, amountToSend);
    }

    await supabaseAdmin
      .from('deposits')
      .update({ status: 'swept', sweep_tx_hash: txHash })
      .eq('id', deposit.id)
      .eq('status', 'confirmed');

    return { swept: true, txHash };
  } catch (e: any) {
    console.error('[sweep] ошибка свипа депозита', deposit.id, e);
    return { swept: false, error: e.message || String(e) };
  }
}
