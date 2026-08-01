import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, TonClient, internal } from '@ton/ton';
import { Address } from '@ton/core';
import { tonCenterBase } from '../network';

export interface TonAccount {
  address: string;
  walletId: number;
}

/**
 * Выводит TON-адрес по индексу депозита.
 *
 * В отличие от TRON/Ethereum, у TON нет "деривации по пути" в привычном
 * BIP44-смысле для получения РАЗНЫХ адресов из одного seed. Вместо этого
 * контракт кошелька v4 принимает параметр walletId (subwallet_id) — один
 * и тот же публичный ключ с разными walletId даёт разные адреса, но все
 * они управляются одной и той же приватной парой ключей из мнемоники.
 *
 * TON_WALLET_ID_BASE фиксирован в env (см. .env.example) — если его
 * поменять после того, как уже выданы реальные адреса, старые адреса
 * "потеряются" (их можно будет восстановить, только зная точный
 * прежний base, так что менять его нельзя без веской причины).
 */
export async function deriveTonAccount(index: number): Promise<TonAccount> {
  const mnemonic = process.env.TON_MNEMONIC;
  if (!mnemonic) throw new Error('TON_MNEMONIC не задан на сервере');
  if (!Number.isInteger(index) || index < 0) throw new Error('Некорректный index деривации');

  const base = Number(process.env.TON_WALLET_ID_BASE || 698983191);
  const walletId = base + index;

  const words = mnemonic.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
    walletId,
  });

  return {
    address: wallet.address.toString({ bounceable: false }),
    walletId,
  };
}

// Тот же трюк, что и для TRON: id депозита начинается с 1, поэтому
// index 0 никогда не выдаётся реальному депозиту и безопасно зарезервирован
// под казначейский кошелёк — управляется той же мнемоникой TON_MNEMONIC,
// отдельный секрет не нужен.
export async function getMasterTonAccount(): Promise<TonAccount> {
  return deriveTonAccount(0);
}

let tonClientInstance: TonClient | null = null;
function getTonClient(): TonClient {
  if (tonClientInstance) return tonClientInstance;
  tonClientInstance = new TonClient({
    endpoint: `${tonCenterBase()}/api/v2/jsonRPC`,
    // На testnet.toncenter.com можно стучаться и без ключа (более щедрые
    // лимиты, чем на мейннете), но если задан TONCENTER_API_KEY — всё равно
    // передаём его, это не мешает.
    apiKey: process.env.TONCENTER_API_KEY,
  });
  return tonClientInstance;
}

export async function getTonBalanceNano(address: string): Promise<bigint> {
  return await getTonClient().getBalance(Address.parse(address));
}

/**
 * Переводит весь баланс (за вычетом резерва на комиссию) TON-адреса с
 * заданным индексом деривации на другой адрес.
 *
 * ВАЖНО — честное предупреждение: в отличие от TRON, где sendTransaction
 * сразу возвращает финальный txid, TON-транзакции строятся по seqno
 * контракта кошелька и подтверждаются асинхронно (сеть обрабатывает их
 * не мгновенно). Эта функция отправляет сообщение и ждёт, пока seqno
 * контракта увеличится (то есть кошелёк принял и обработал сообщение),
 * но НЕ возвращает настоящий хэш транзакции для сверки — вместо этого
 * возвращает служебную метку с seqno. Перед тем как полагаться на это
 * с реальными деньгами, обязательно прогони через TON testnet и сверь
 * поведение в https://testnet.tonscan.org по адресу мастер-кошелька.
 */
export async function sweepAllTon(index: number, toAddress: string): Promise<{ label: string; sentNano: bigint }> {
  const mnemonic = process.env.TON_MNEMONIC;
  if (!mnemonic) throw new Error('TON_MNEMONIC не задан на сервере');

  const base = Number(process.env.TON_WALLET_ID_BASE || 698983191);
  const walletId = base + index;
  const words = mnemonic.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);

  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey, walletId });
  const client = getTonClient();
  const contract = client.open(wallet);

  const balance = await contract.getBalance();
  const RESERVE_NANO = BigInt(process.env.TON_SWEEP_RESERVE_NANO || 20000000); // ~0.02 TON про запас на комиссию сети
  if (balance <= RESERVE_NANO) {
    throw new Error(`Баланс (${balance} nanoTON) слишком мал для свипа с учётом резерва ${RESERVE_NANO}`);
  }
  const amountToSend = balance - RESERVE_NANO;

  const seqno = await contract.getSeqno();
  await contract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [internal({ to: toAddress, value: amountToSend, bounce: false })],
  });

  return { label: `seqno:${seqno}`, sentNano: amountToSend };
}
