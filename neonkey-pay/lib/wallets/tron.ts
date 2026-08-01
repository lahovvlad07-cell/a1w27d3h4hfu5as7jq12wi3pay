import * as bip39 from 'bip39';
import { HDKey } from '@scure/bip32';
// @ts-expect-error — у tronweb нет собственных типов
import TronWebPkg from 'tronweb';

// TronWeb в CommonJS экспортируется по-разному в зависимости от версии/бандлера
const TronWeb = (TronWebPkg as any).TronWeb || TronWebPkg;

let tronWebInstance: any = null;
export function getTronWeb() {
  if (tronWebInstance) return tronWebInstance;
  const apiKey = process.env.TRONGRID_API_KEY;
  tronWebInstance = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined,
  });
  return tronWebInstance;
}

export interface TronAccount {
  address: string;
  privateKeyHex: string;
}

/**
 * Выводит TRON-аккаунт по индексу депозита из общей мнемоники.
 * Путь m/44'/195'/0'/0/{index} — 195 это coin type TRON (SLIP-44).
 * TRON использует ту же кривую secp256k1, что и Ethereum.
 *
 * ВАЖНО: раньше здесь использовались `bip32` + `tiny-secp256k1` — вторая
 * библиотека грузит WASM-бинарник в рантайме, а Vercel serverless не
 * всегда включает такие файлы в бандл функции (реальная ошибка была:
 * "ENOENT: no such file or directory, open '.../secp256k1.wasm'").
 * `@scure/bip32` делает то же самое (BIP32-деривация), но чистым JS без
 * WASM/нативных бинарников — специально создан для таких сред, включая
 * serverless. Формат путей деривации и результат идентичны.
 */
export function deriveTronAccount(index: number): TronAccount {
  const mnemonic = process.env.TRON_HD_MNEMONIC;
  if (!mnemonic) throw new Error('TRON_HD_MNEMONIC не задан на сервере');
  if (!Number.isInteger(index) || index < 0) throw new Error('Некорректный index деривации');

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`m/44'/195'/0'/0/${index}`);
  if (!child.privateKey) throw new Error('Не удалось получить приватный ключ');

  const privateKeyHex = Buffer.from(child.privateKey).toString('hex');
  const address = getTronWeb().address.fromPrivateKey(privateKeyHex);

  return { address, privateKeyHex };
}

// id в таблице deposits (bigserial) начинается с 1 — значит индекс 0
// никогда не будет выдан реальному депозиту, и его безопасно можно
// зарезервировать под казначейский/газовый кошелёк. Так его адрес и
// приватный ключ выводятся той же самой функцией, что и для депозитов,
// и не нужен отдельный секрет MASTER_TRON_PRIVATE_KEY в переменных
// окружения — на один секрет меньше, которым можно было бы ошибиться.
export function getMasterTronAccount(): TronAccount {
  return deriveTronAccount(0);
}

const USDT_TRC20_CONTRACT = process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_DECIMALS = 6;

/** Отдельный экземпляр TronWeb с конкретным приватным ключом — для подписи
 *  транзакций. Не переиспользует общий getTronWeb() (тот без ключа, только
 *  для чтения), чтобы параллельные свипы разных депозитов не путали друг
 *  другу текущий ключ подписи через общий мутируемый инстанс. */
function tronWebWithKey(privateKeyHex: string) {
  const apiKey = process.env.TRONGRID_API_KEY;
  return new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined,
    privateKey: privateKeyHex,
  });
}

export async function getTrxBalanceSun(address: string): Promise<number> {
  return await getTronWeb().trx.getBalance(address);
}

export async function getUsdtBalanceRaw(address: string): Promise<bigint> {
  const contract = await getTronWeb().contract().at(USDT_TRC20_CONTRACT);
  const result = await contract.balanceOf(address).call();
  return BigInt(result.toString());
}

export function usdtToRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDT_DECIMALS));
}
export function rawToUsdt(raw: bigint): number {
  return Number(raw) / 10 ** USDT_DECIMALS;
}

/** Отправляет весь (за вычетом резерва) баланс TRX с одного адреса на другой. */
export async function sendTrx(fromPrivateKeyHex: string, toAddress: string, amountSun: number): Promise<string> {
  if (amountSun <= 0) throw new Error('Сумма TRX для отправки должна быть положительной');
  const tw = tronWebWithKey(fromPrivateKeyHex);
  const result = await tw.trx.sendTransaction(toAddress, Math.floor(amountSun), fromPrivateKeyHex);
  if (!result?.result) throw new Error(`TRON отклонил отправку TRX: ${JSON.stringify(result)}`);
  return result.txid;
}

/** Отправляет указанное количество USDT (TRC-20) с одного адреса на другой. */
export async function sendUsdt(fromPrivateKeyHex: string, toAddress: string, amountRaw: bigint): Promise<string> {
  if (amountRaw <= 0n) throw new Error('Сумма USDT для отправки должна быть положительной');
  const tw = tronWebWithKey(fromPrivateKeyHex);
  const fromAddress = tw.address.fromPrivateKey(fromPrivateKeyHex);
  tw.setAddress(fromAddress);
  const contract = await tw.contract().at(USDT_TRC20_CONTRACT);
  const txid: string = await contract.transfer(toAddress, amountRaw.toString()).send({ from: fromAddress });
  return txid;
}
