// ===== ПРОВАЙДЕР CRYPTO BOT (Crypto Pay API) =====
//
// В отличие от TRON/TON, здесь нет "своего" одноразового адреса — вместо
// этого создаётся инвойс на стороне CryptoBot, и пользователю выдаётся
// ссылка на оплату. Деньги остаются в кастодиальном балансе CryptoBot,
// свипать их некуда — см. lib/sweep.ts, там для этой валюты отдельная
// ветка без реального перевода.
//
// Документация: https://help.send.tg/en/articles/10279948-crypto-pay-api
// Токен приложения выдаётся ботом @CryptoBot -> Crypto Pay -> Create App.
//
// ⚠️ ЧЕСТНОЕ ПРЕДУПРЕЖДЕНИЕ: названия полей ниже (invoice_id, pay_url,
// mini_app_invoice_url, status и т.д.) взяты из официальной документации
// Crypto Pay API на момент написания, но API может измениться. Прежде
// чем полагаться на это с реальными деньгами — создай тестовый инвойс на
// небольшую сумму и вручную сверь реальный ответ API с тем, что здесь
// ожидается (см. console.log в create.ts/verifyDeposit.ts при первом
// прогоне).

const API_BASE = 'https://pay.crypt.bot/api';

// Актив, в котором CryptoBot выставляет счёт. USDT — самый универсальный
// выбор (столько же, сколько сейчас используется для USDT_TRC20), но
// можно переопределить в .env, если решишь принимать TON/TRX/BTC и т.д.
// Полный список поддерживаемых активов — в getCurrencies() метода API.
const ASSET = process.env.CRYPTOBOT_ASSET || 'USDT';

export interface ProviderInvoice {
  invoiceId: string;
  payUrl: string;
}

export interface ProviderInvoiceStatus {
  status: 'active' | 'paid' | 'expired';
  paidAmount?: number;
}

function getToken(): string {
  const token = process.env.CRYPTOBOT_API_TOKEN;
  if (!token) throw new Error('CRYPTOBOT_API_TOKEN не задан на сервере');
  return token;
}

/**
 * Создаёт инвойс на amountCrypto единиц ASSET. payload — обычно
 * `deposit:${depositId}`, чтобы при желании можно было сверить инвойс
 * с депозитом даже без своей базы (пригодится, если когда-нибудь
 * подключишь вебхук вместо поллинга).
 */
export async function createCryptoBotInvoice(
  amountCrypto: number,
  payload: string,
  expiresInSeconds: number
): Promise<ProviderInvoice> {
  const res = await fetch(`${API_BASE}/createInvoice`, {
    method: 'POST',
    headers: { 'Crypto-Pay-API-Token': getToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset: ASSET,
      // API ожидает amount строкой с фиксированной точностью.
      amount: amountCrypto.toFixed(8),
      payload,
      expires_in: expiresInSeconds,
    }),
  });

  let json: any = {};
  try { json = await res.json(); } catch (e) { /* пустой/невалидный JSON */ }

  if (!res.ok || !json.ok) {
    throw new Error(`CryptoBot createInvoice: ${json?.error?.name || json?.error?.code || res.status}`);
  }

  const inv = json.result;
  // mini_app_invoice_url — открывается прямо внутри Telegram (без выхода
  // в браузер), поэтому предпочитаем его; pay_url — универсальный фолбэк.
  const payUrl = inv.mini_app_invoice_url || inv.web_app_invoice_url || inv.pay_url || inv.bot_invoice_url;
  if (!payUrl) throw new Error('CryptoBot createInvoice: в ответе не найдена ссылка на оплату');

  return { invoiceId: String(inv.invoice_id), payUrl };
}

/** Проверяет статус ранее созданного инвойса по его id. */
export async function checkCryptoBotInvoice(invoiceId: string): Promise<ProviderInvoiceStatus> {
  const res = await fetch(`${API_BASE}/getInvoices?invoice_ids=${encodeURIComponent(invoiceId)}`, {
    headers: { 'Crypto-Pay-API-Token': getToken() },
  });

  let json: any = {};
  try { json = await res.json(); } catch (e) { /* пустой/невалидный JSON */ }

  if (!res.ok || !json.ok) {
    throw new Error(`CryptoBot getInvoices: ${json?.error?.name || json?.error?.code || res.status}`);
  }

  const inv = json.result?.items?.[0];
  if (!inv) return { status: 'expired' };

  const status: ProviderInvoiceStatus['status'] =
    inv.status === 'paid' ? 'paid' : inv.status === 'expired' ? 'expired' : 'active';

  return { status, paidAmount: inv.paid_amount !== undefined ? Number(inv.paid_amount) : undefined };
}
