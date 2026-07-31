import type { NextApiRequest, NextApiResponse } from 'next';
import { checkInternalToken } from '@/lib/auth';
import { getMasterTronAccount, getTrxBalanceSun, getUsdtBalanceRaw, rawToUsdt } from '@/lib/wallets/tron';
import { getMasterTonAccount, getTonBalanceNano } from '@/lib/wallets/ton';

export const config = {
  api: { bodyParser: true },
  maxDuration: 30,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }
  if (!checkInternalToken(req)) {
    return res.status(401).json({ error: 'Неверный или отсутствующий x-internal-token' });
  }

  try {
    const tronMaster = getMasterTronAccount();
    const tonMaster = await getMasterTonAccount();

    const [trxSun, usdtRaw, tonNano] = await Promise.all([
      getTrxBalanceSun(tronMaster.address).catch(() => null),
      getUsdtBalanceRaw(tronMaster.address).catch(() => null),
      getTonBalanceNano(tonMaster.address).catch(() => null),
    ]);

    return res.status(200).json({
      tron: {
        address: tronMaster.address,
        trxBalance: trxSun !== null ? trxSun / 1_000_000 : null,
        usdtBalance: usdtRaw !== null ? rawToUsdt(usdtRaw) : null,
      },
      ton: {
        address: tonMaster.address,
        tonBalance: tonNano !== null ? Number(tonNano) / 1_000_000_000 : null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Не удалось получить данные казначейства' });
  }
}
