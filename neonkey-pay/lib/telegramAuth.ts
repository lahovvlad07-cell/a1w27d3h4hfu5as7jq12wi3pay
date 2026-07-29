import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface ValidationResult {
  ok: boolean;
  user?: TelegramUser;
  error?: string;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // initData старше суток отклоняем

/**
 * Проверяет initData, присланный из Telegram Mini App, по алгоритму из
 * официальной документации Telegram:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * ВАЖНО: любой эндпоинт, который меняет баланс или создаёт платёж,
 * ДОЛЖЕН вызывать эту функцию и брать user_id из результата, а не из
 * тела запроса — иначе клиент может просто отправить чужой user_id.
 */
export function validateTelegramInitData(initData: string, botToken: string): ValidationResult {
  if (!initData) return { ok: false, error: 'initData отсутствует' };
  if (!botToken) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не задан на сервере' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'В initData нет hash' };
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return { ok: false, error: 'Неверная подпись initData' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (!authDate || ageSeconds > MAX_AUTH_AGE_SECONDS) {
    return { ok: false, error: 'initData устарела, открой Mini App заново' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, error: 'В initData нет данных пользователя' };

  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    return { ok: true, user };
  } catch {
    return { ok: false, error: 'Не удалось разобрать данные пользователя' };
  }
}
