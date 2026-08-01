// ===== ПРОВЕРКА ВХОДЯЩИХ ПЛАТЕЖЕЙ В БЛОКЧЕЙНЕ =====
//
// ВАЖНО: этот файл читает публичные API TronGrid/TonCenter — они дают
// историю транзакций конкретного адреса, поэтому отдельного вебхука не
// нужно (см. README про polling вместо push-уведомлений). Прежде чем
// доверять этому реальными деньгами — обязательно прогони весь цикл на
// тестнете (Nile для TRON, testnet для TON) — переключается через
// TRON_NETWORK=nile / TON_NETWORK=testnet в .env, см. lib/network.ts.

import { tronFullHost, tonCenterBase, usdtTrc20Contract } from './network';

const USDT_TRC20_CONTRACT = usdtTrc20Contract();

export interface IncomingCheckResult {
  found: boolean;
  txHash?: string;
  receivedAmount?: number; // в единицах валюты (USDT/TRX/TON), не в raw/sun/nano
  underpaid?: boolean;
}

/**
 * Ищет входящий платёж на TRON-адрес (нативный TRX или TRC-20 USDT) среди
 * последних транзакций этого адреса. Возвращает первую транзакцию, которая
 * покрывает ожидаемую сумму (с небольшим допуском на округление).
 */
export async function checkTronIncoming(
  address: string,
  isUsdt: boolean,
  expectedAmountCrypto: number
): Promise<IncomingCheckResult> {
  const apiKey = process.env.TRONGRID_API_KEY;
  const headers: Record<string, string> = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};

  const url = isUsdt
    ? `${tronFullHost()}/v1/accounts/${address}/transactions/trc20?contract_address=${USDT_TRC20_CONTRACT}&only_to=true&limit=20`
    : `${tronFullHost()}/v1/accounts/${address}/transactions?only_to=true&limit=20`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`TronGrid ответил ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const items: any[] = json.data || [];

  // Допуск 1% вниз — на случай, если курс/округление на копейку разошлись
  // между моментом создания депозита и моментом фактической оплаты.
  const TOLERANCE = 0.99;
  let bestUnderpaid: IncomingCheckResult | null = null;

  for (const tx of items) {
    let amount: number;
    let txHash: string;

    if (isUsdt) {
      // TRC-20: value — строка в минимальных единицах, decimals обычно 6 у USDT
      const decimals = Number(tx.token_info?.decimals ?? 6);
      amount = Number(tx.value) / 10 ** decimals;
      txHash = tx.transaction_id;
    } else {
      // Нативный TRX: сумма в SUN (1 TRX = 1_000_000 SUN), контракт TransferContract
      const contract = tx.raw_data?.contract?.[0];
      if (contract?.type !== 'TransferContract') continue;
      const success = tx.ret?.[0]?.contractRet === 'SUCCESS';
      if (!success) continue;
      amount = Number(contract.parameter?.value?.amount || 0) / 1_000_000;
      txHash = tx.txID;
    }

    if (amount >= expectedAmountCrypto * TOLERANCE) {
      return { found: true, txHash, receivedAmount: amount };
    }
    if (!bestUnderpaid || amount > (bestUnderpaid.receivedAmount || 0)) {
      bestUnderpaid = { found: false, underpaid: true, txHash, receivedAmount: amount };
    }
  }

  return bestUnderpaid || { found: false };
}

/**
 * Ищет входящий платёж на TON-адрес среди последних транзакций.
 */
export async function checkTonIncoming(
  address: string,
  expectedAmountCrypto: number
): Promise<IncomingCheckResult> {
  const apiKey = process.env.TONCENTER_API_KEY;
  const url = `${tonCenterBase()}/api/v2/getTransactions?address=${encodeURIComponent(address)}&limit=20${apiKey ? `&api_key=${apiKey}` : ''}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TonCenter ответил ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const items: any[] = json.result || [];

  const TOLERANCE = 0.99;
  let bestUnderpaid: IncomingCheckResult | null = null;

  for (const tx of items) {
    const inMsg = tx.in_msg;
    if (!inMsg || !inMsg.value || Number(inMsg.value) === 0) continue; // исходящие/пустые пропускаем

    const amount = Number(inMsg.value) / 1_000_000_000; // nanoton -> TON
    const txHash: string = tx.transaction_id?.hash || '';

    if (amount >= expectedAmountCrypto * TOLERANCE) {
      return { found: true, txHash, receivedAmount: amount };
    }
    if (!bestUnderpaid || amount > (bestUnderpaid.receivedAmount || 0)) {
      bestUnderpaid = { found: false, underpaid: true, txHash, receivedAmount: amount };
    }
  }

  return bestUnderpaid || { found: false };
}
