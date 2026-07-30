import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Эндпоинты create/check дёргаются напрямую браузером из Telegram
 * Mini App — а это ДРУГОЙ домен (сама Mini App лежит отдельно, не на
 * этом же Vercel-деплое), значит без явных CORS-заголовков браузер
 * просто заблокирует запрос ещё до того, как он дойдёт до сервера
 * (или до того, как ответ дойдёт обратно до кода на странице).
 *
 * Возвращает true, если это был preflight OPTIONS-запрос и обработка
 * уже завершена (ответ отправлен) — в этом случае вызывающий handler
 * должен сразу же return.
 */
export function applyCors(req: NextApiRequest, res: NextApiResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-token');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
