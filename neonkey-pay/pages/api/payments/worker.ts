import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkInternalToken } from '@/lib/auth';
import { verifyDeposit } from '@/lib/verifyDeposit';
import { DEPOSIT_EXPIRY_MINUTES } from '@/lib/depositExpiry';

/**
 * Дергается внешним cron (cron-job.org) раз в минуту. Делает две вещи
 * для ВСЕХ pending-депозитов сразу, независимо от того, открыт ли у
 * кого-то Mini App прямо сейчас:
 *
 * 1. Депозиты старше DEPOSIT_EXPIRY_MINUTES — помечает 'expired' (никого
 *    не начисляет, адрес по нему платить больше нельзя).
 * 2. Остальные pending — прогоняет через ту же verifyDeposit(), что и
 *    ручная кнопка "Проверить", на случай если пользователь заплатил и
 *    закрыл приложение, не дождавшись подтверждения.
 *
 * Настройка cron-job.org: URL этого эндпоинта, метод POST, заголовок
 * x-internal-token: <тот же INTERNAL_API_TOKEN, что в .env>, раз в 1 минуту.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }
  if (!checkInternalToken(req)) {
    return res.status(401).json({ error: 'Неверный или отсутствующий x-internal-token' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Сервер не настроен (Supabase)' });
  }

  try {
    const cutoff = new Date(Date.now() - DEPOSIT_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // Шаг 1: массово просрочиваем всё, что старше окна ожидания.
    // .select() возвращает список того, что реально обновилось — не
    // трогаем то, что кто-то параллельно уже подтвердил (.eq('status','pending')
    // защищает и здесь).
    const { data: expiredRows, error: expireError } = await supabaseAdmin
      .from('deposits')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .select('id');

    if (expireError) {
      console.error('[worker] ошибка просрочки депозитов:', expireError);
    }

    // Шаг 2: остальные pending (ещё в пределах окна) — проверяем по блокчейну.
    const { data: pendingRows, error: fetchError } = await supabaseAdmin
      .from('deposits')
      .select('*')
      .eq('status', 'pending')
      .gte('created_at', cutoff);

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    const results = [];
    for (const deposit of pendingRows || []) {
      const result = await verifyDeposit(deposit);
      results.push({ id: deposit.id, status: result.status, error: result.error });
    }

    return res.status(200).json({
      expiredCount: (expiredRows || []).length,
      checkedCount: results.length,
      confirmedCount: results.filter((r) => r.status === 'confirmed').length,
      results,
    });
  } catch (e: any) {
    console.error('[worker] error:', e);
    return res.status(500).json({ error: e.message || 'Ошибка фонового воркера' });
  }
}
