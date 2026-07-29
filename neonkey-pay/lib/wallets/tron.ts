import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
// @ts-expect-error — у tronweb нет собственных типов
import TronWebPkg from 'tronweb';

const bip32 = BIP32Factory(ecc);

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
 * TRON использует ту же кривую secp256k1, что и Ethereum, поэтому
 * обычный BIP32 подходит — TronWeb только оборачивает приватный ключ
 * в свой формат адреса (base58, префикс "T").
 */
export function deriveTronAccount(index: number): TronAccount {
  const mnemonic = process.env.TRON_HD_MNEMONIC;
  if (!mnemonic) throw new Error('TRON_HD_MNEMONIC не задан на сервере');
  if (!Number.isInteger(index) || index < 0) throw new Error('Некорректный index деривации');

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(`m/44'/195'/0'/0/${index}`);
  if (!child.privateKey) throw new Error('Не удалось получить приватный ключ');

  const privateKeyHex = Buffer.from(child.privateKey).toString('hex');
  const address = getTronWeb().address.fromPrivateKey(privateKeyHex);

  return { address, privateKeyHex };
}
