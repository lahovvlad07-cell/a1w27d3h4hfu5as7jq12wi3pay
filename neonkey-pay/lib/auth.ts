import type { NextApiRequest } from 'next';
import { validateTelegramInitData } from './telegramAuth';

interface AuthResult {
  ok: boolean;
  userId?: number;
  error?: string;
  viaInternalToken?: boolean;
}

/**
 * Два способа подтвердить, для какого user_id выполняется операция:
 *
 * 1. Telegram initData — используется реальным Mini App. user_id
 *    берётся из подписанных Telegram данных, подделать нельзя.
 * 2. Внутренний токен (заголовок x-internal-token, сверяется с
 *    INTERNAL_API_TOKEN) — используется этим дашбордом и будущим
 *    cron-воркером, у которых нет контекста Telegram. В этом случае
 *    user_id передаётся прямо в теле запроса и мы ему доверяем,
 *    ПОТОМУ ЧТО токен известен только тебе — это уже сервер-сервер
 *    доверие, а не запрос от постороннего браузера.
 */
export function resolveAuthenticatedUser(req: NextApiRequest): AuthResult {
  const internalToken = req.headers['x-internal-token'];
  const expectedToken = process.env.INTERNAL_API_TOKEN;

  if (internalToken && expectedToken && internalToken === expectedToken) {
    const userId = Number(req.body?.userId);
    if (!userId) {
      return { ok: false, error: 'При использовании internal-token в теле запроса обязателен числовой userId' };
    }
    return { ok: true, userId, viaInternalToken: true };
  }

  const { initData } = req.body || {};
  const auth = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN || '');
  if (!auth.ok || !auth.user) {
    return { ok: false, error: auth.error || 'Не удалось подтвердить пользователя' };
  }
  return { ok: true, userId: auth.user.id, viaInternalToken: false };
}

/** Простая проверка только внутреннего токена — для эндпоинтов без понятия "пользователь" (список депозитов, cron-воркер). */
export function checkInternalToken(req: NextApiRequest): boolean {
  const token = req.headers['x-internal-token'];
  const expected = process.env.INTERNAL_API_TOKEN;
  return Boolean(token && expected && token === expected);
}
