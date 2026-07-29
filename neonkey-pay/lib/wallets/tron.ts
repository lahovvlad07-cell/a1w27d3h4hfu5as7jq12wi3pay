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
