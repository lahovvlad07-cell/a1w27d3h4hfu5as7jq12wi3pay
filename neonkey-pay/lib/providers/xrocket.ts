// ===== ПРОВАЙДЕР xRocket (Rocket Pay API) =====
//
// Та же логика, что и для CryptoBot (см. cryptobot.ts) — инвойс вместо
// одноразового адреса, деньги остаются на кастодиальном балансе xRocket.
//
// Документация/SDK: https://xrocket.tg/api , см. также
// xrocket-pay-ts-sdk / rocketpay (Python) на GitHub. Ключ приложения
// выдаётся ботом @xRocket -> Rocket Pay -> Create App -> API token.
// Заголовок авторизации — Rocket-Pay-Key (это ОБЯЗАТЕЛЬНО заголовок,
// не query-параметр и не Bearer).
//
// ⚠️ ЧЕСТНОЕ ПРЕДУПРЕЖДЕНИЕ: так же как и с CryptoBot — названия полей
// (id, link/payUrl, status, currency-коды вроде "USDT"/"TONCOIN") взяты
// из публичной документации/SDK на момент написания и не проверялись
// вручную против реального ответа API в этом проекте. Обязательно
// создай тестовый инвойс на минимальную сумму и залогируй сырой ответ
// (json ниже), прежде чем доверять этому реальными деньгами.

const API_BASE = 'https://pay.xrocket.tg';

// Валюта инвойса. USDT — для параллели с остальными настройками (курс
// считается так же, как для USDT_TRC20). Если оставишь TONCOIN — не
// забудь завести отдельный курс в settings (см. rates.ts).
const CURRENCY = process.env.XROCKET_ASSET || 'USDT';

export interface ProviderInvoice {
  invoiceId: string;
  payUrl: string;
}

export interface ProviderInvoiceStatus {
  status: 'active' | 'paid' | 'expired';
  paidAmount?: number;
}

function getKey(): string {
  const key = process.env.XROCKET_API_KEY;
  if (!key) throw new Error('XROCKET_API_KEY не задан на сервере');
  return key;
}

export async function createXRocketInvoice(
  amountCrypto: number,
  payload: string,
  expiresInSeconds: number
): Promise<ProviderInvoice> {
  const res = await fetch(`${API_BASE}/tg-invoices`, {
    method: 'POST',
    headers: { 'Rocket-Pay-Key': getKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountCrypto,
      currency: CURRENCY,
      description: payload,
      numPayments: 1,
      expiredIn: expiresInSeconds,
    }),
  });

  let json: any = {};
  try { json = await res.json(); } catch (e) { /* пустой/невалидный JSON */ }

  if (!res.ok) {
    throw new Error(`xRocket createInvoice: ${json?.message || res.status}`);
  }

  const inv = json.data || json;
  const invoiceId = inv.id ?? inv.invoiceId;
  const payUrl = inv.link ?? inv.payUrl ?? inv.pay_url;
  if (!invoiceId || !payUrl) {
    throw new Error('xRocket createInvoice: не удалось разобрать id/ссылку из ответа API');
  }

  return { invoiceId: String(invoiceId), payUrl };
}

export async function checkXRocketInvoice(invoiceId: string): Promise<ProviderInvoiceStatus> {
  const res = await fetch(`${API_BASE}/tg-invoices/${encodeURIComponent(invoiceId)}`, {
    headers: { 'Rocket-Pay-Key': getKey() },
  });

  let json: any = {};
  try { json = await res.json(); } catch (e) { /* пустой/невалидный JSON */ }

  if (!res.ok) {
    throw new Error(`xRocket getInvoice: ${json?.message || res.status}`);
  }

  const inv = json.data || json;
  const paid =
    inv.status === 'paid' ||
    (Array.isArray(inv.payments) && inv.payments.length > 0);
  const status: ProviderInvoiceStatus['status'] = paid ? 'paid' : inv.status === 'expired' ? 'expired' : 'active';

  return { status, paidAmount: inv.amount !== undefined ? Number(inv.amount) : undefined };
}
