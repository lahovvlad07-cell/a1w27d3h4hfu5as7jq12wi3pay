import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';

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
