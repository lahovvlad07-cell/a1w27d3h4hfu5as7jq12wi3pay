import { useEffect, useState, FormEvent } from 'react';

type Currency = 'USDT_TRC20' | 'TRX' | 'TON' | 'CRYPTOBOT' | 'XROCKET';

const CURRENCY_LABEL: Record<Currency, string> = {
  USDT_TRC20: 'USDT (TRC-20)',
  TRX: 'TRX',
  TON: 'TON',
  CRYPTOBOT: 'CryptoBot',
  XROCKET: 'xRocket',
};

interface CreateResult {
  depositId: number;
  address: string | null;
  payUrl?: string | null;
  currency: Currency;
  amountRub: number;
  rateUsed: number;
  grossAmountCrypto: number;
  commissionCrypto: number;
  expectedAmountCrypto: number;
}

interface Deposit {
  id: number;
  user_id: number;
  currency: Currency;
  address: string | null;
  pay_url?: string | null;
  amount_rub: number;
  rate_used: number;
  commission_crypto: number;
  expected_amount_crypto: number;
  status: 'pending' | 'confirmed' | 'expired' | 'swept';
  created_at: string;
}

const STATUS_LABEL: Record<Deposit['status'], string> = {
  pending: '⏳ Ожидает',
  confirmed: '✅ Оплачен',
  expired: '⌛ Истёк',
  swept: '📤 Выведен',
};

export default function Home() {
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);

  const [currency, setCurrency] = useState<Currency>('USDT_TRC20');
  const [amountRub, setAmountRub] = useState('3000');
  const [testUserId, setTestUserId] = useState('1');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [treasury, setTreasury] = useState<any>(null);
  const [treasuryError, setTreasuryError] = useState<string | null>(null);
  const [treasuryLoading, setTreasuryLoading] = useState(false);
  const [sweepingId, setSweepingId] = useState<number | null>(null);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('neonkey_pay_token');
    if (saved) {
      setToken(saved);
      setTokenSaved(true);
    }
  }, []);

  useEffect(() => {
    if (tokenSaved) {
      loadDeposits();
      loadTreasury();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenSaved]);

  function saveToken() {
    window.localStorage.setItem('neonkey_pay_token', token);
    setTokenSaved(true);
  }
  function forgetToken() {
    window.localStorage.removeItem('neonkey_pay_token');
    setToken('');
    setTokenSaved(false);
    setDeposits(null);
  }

  async function loadDeposits() {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/payments/list?limit=20', {
        headers: { 'x-internal-token': token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
      setDeposits(data.deposits);
    } catch (e: any) {
      setListError(e.message);
    } finally {
      setListLoading(false);
    }
  }

  async function createPayment(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setResult(null);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          userId: Number(testUserId),
          currency,
          amountRub: Number(amountRub),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания платежа');
      setResult(data);
      loadDeposits();
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  function copyAddress(addr: string) {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function loadTreasury() {
    setTreasuryLoading(true);
    setTreasuryError(null);
    try {
      const res = await fetch('/api/payments/treasury', {
        headers: { 'x-internal-token': token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки казначейства');
      setTreasury(data);
    } catch (e: any) {
      setTreasuryError(e.message);
    } finally {
      setTreasuryLoading(false);
    }
  }

  async function sweepNow(depositId: number) {
    setSweepingId(depositId);
    setSweepMessage(null);
    try {
      const res = await fetch('/api/payments/sweep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({ depositId }),
      });
      const data = await res.json();
      if (data.swept) {
        setSweepMessage(`✅ Депозит #${depositId} свипнут (tx ${data.txHash})`);
      } else {
        setSweepMessage(`⚠️ Депозит #${depositId}: ${data.error || 'свип не удался'}`);
      }
      loadDeposits();
      loadTreasury();
    } catch (e: any) {
      setSweepMessage(`⚠️ Депозит #${depositId}: ${e.message}`);
    } finally {
      setSweepingId(null);
    }
  }

  async function checkPayment(depositId: number) {
    setChecking(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      const res = await fetch('/api/payments/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({ depositId, userId: Number(testUserId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка проверки');
      setCheckResult(data);
      loadDeposits();
    } catch (e: any) {
      setCheckError(e.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="wrap">
      <div className="brand">
        <span className="brand-icon">💠</span>
        <div>
          <h1>NeonKey Pay</h1>
          <span>Внутренний платёжный сервис — приём USDT/TRX/TON</span>
        </div>
      </div>

      {!tokenSaved ? (
        <div className="card">
          <h2>🔑 Доступ</h2>
          <p className="muted">
            Это приватная админ-панель — введи <code>INTERNAL_API_TOKEN</code>, тот же,
            что задан в переменных окружения на Vercel. Он сохранится в этом браузере.
          </p>
          <div className="field">
            <label>Internal token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="INTERNAL_API_TOKEN"
            />
          </div>
          <button className="btn full" onClick={saveToken} disabled={!token}>
            Войти
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>
              🏦 Казначейство
              <button className="btn secondary" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={loadTreasury}>
                ⟳ Обновить
              </button>
            </h2>
            <p className="muted">
              Это адреса с индексом деривации 0 — они никогда не выдаются депозитам
              (id начинается с 1), поэтому безопасно используются как казначейский
              кошелёк для того же seed. Именно сюда свипаются подтверждённые платежи.
            </p>
            {treasuryLoading && <p className="muted">Загрузка…</p>}
            {treasuryError && <div className="error-box">⚠️ {treasuryError}</div>}
            {treasury && (
              <>
                <p className="muted" style={{ marginBottom: 4 }}>TRON (USDT/TRX):</p>
                <div className="address-box" onClick={() => copyAddress(treasury.tron.address)}>
                  {treasury.tron.address}
                </div>
                <div className="result-row">
                  <span>Баланс TRX</span>
                  <strong>{treasury.tron.trxBalance !== null ? treasury.tron.trxBalance.toFixed(4) : '—'}</strong>
                </div>
                <div className="result-row">
                  <span>Баланс USDT</span>
                  <strong>{treasury.tron.usdtBalance !== null ? treasury.tron.usdtBalance.toFixed(4) : '—'}</strong>
                </div>
                <p className="muted" style={{ margin: '14px 0 4px' }}>TON:</p>
                <div className="address-box" onClick={() => copyAddress(treasury.ton.address)}>
                  {treasury.ton.address}
                </div>
                <div className="result-row">
                  <span>Баланс TON</span>
                  <strong>{treasury.ton.tonBalance !== null ? treasury.ton.tonBalance.toFixed(4) : '—'}</strong>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2>🧪 Тестовое создание платежа</h2>
            <p className="muted">
              Здесь можно проверить, что деривация адреса и расчёт суммы работают правильно,
              не заходя в сам Mini App. В реальном потоке <code>userId</code> будет браться
              из подписанной Telegram initData, а не вводиться руками.
            </p>
            <form onSubmit={createPayment}>
              <div className="row">
                <div className="field">
                  <label>Валюта</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                    <option value="USDT_TRC20">USDT (TRC-20)</option>
                    <option value="TRX">TRX</option>
                    <option value="TON">TON</option>
                    <option value="CRYPTOBOT">CryptoBot</option>
                    <option value="XROCKET">xRocket</option>
                  </select>
                </div>
                <div className="field">
                  <label>Сумма, ₽</label>
                  <input
                    type="number"
                    value={amountRub}
                    onChange={(e) => setAmountRub(e.target.value)}
                    min={1}
                  />
                </div>
              </div>
              <div className="field">
                <label>Тестовый user_id</label>
                <input
                  type="number"
                  value={testUserId}
                  onChange={(e) => setTestUserId(e.target.value)}
                />
              </div>
              <button className="btn full" type="submit" disabled={creating}>
                {creating ? 'Создаём…' : 'Создать платёж'}
              </button>
            </form>

            {createError && <div className="error-box">⚠️ {createError}</div>}

            {result && (
              <div className="result-box">
                <div className="result-row">
                  <span>Депозит</span>
                  <strong>#{result.depositId}</strong>
                </div>
                <div className="result-row">
                  <span>Курс</span>
                  <strong>1 {CURRENCY_LABEL[result.currency]} = {result.rateUsed.toFixed(2)} ₽</strong>
                </div>
                <div className="result-row">
                  <span>Сумма по курсу</span>
                  <strong>{result.grossAmountCrypto.toFixed(6)} {result.currency === 'USDT_TRC20' ? 'USDT' : result.currency}</strong>
                </div>
                <div className="result-row">
                  <span>Комиссия сети</span>
                  <strong>{result.commissionCrypto} {result.currency === 'USDT_TRC20' ? 'USDT' : result.currency}</strong>
                </div>
                <div className="result-row highlight">
                  <span>Итого к отправке</span>
                  <strong>{result.expectedAmountCrypto.toFixed(6)} {result.currency === 'USDT_TRC20' ? 'USDT' : result.currency}</strong>
                </div>
                {result.address ? (
                  <>
                    <p className="muted" style={{ marginTop: 10, marginBottom: 4 }}>Адрес (нажми, чтобы скопировать):</p>
                    <div className="address-box" onClick={() => copyAddress(result.address as string)}>
                      {result.address}
                    </div>
                    {copied && <p className="muted" style={{ color: '#00ff88' }}>Скопировано ✓</p>}
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 10, marginBottom: 4 }}>Ссылка на оплату инвойса:</p>
                    <div className="address-box">
                      {result.payUrl ? <a href={result.payUrl} target="_blank" rel="noreferrer">{result.payUrl}</a> : '—'}
                    </div>
                  </>
                )}

                <button
                  className="btn full"
                  style={{ marginTop: 12 }}
                  onClick={() => checkPayment(result.depositId)}
                  disabled={checking}
                >
                  {checking ? 'Проверяем блокчейн…' : '🔍 Проверить оплату'}
                </button>
                {checkError && <div className="error-box">⚠️ {checkError}</div>}
                {checkResult && (
                  <div className="result-box" style={{ marginTop: 10 }}>
                    {checkResult.status === 'confirmed' && !checkResult.alreadyProcessed && (
                      <p style={{ color: '#00ff88' }}>
                        ✅ Оплата найдена (tx {checkResult.txHash}), баланс пользователя пополнен на {checkResult.creditedRub} ₽.
                      </p>
                    )}
                    {checkResult.status === 'confirmed' && checkResult.alreadyProcessed && (
                      <p style={{ color: '#00ff88' }}>✅ Уже подтверждён ранее.</p>
                    )}
                    {checkResult.status === 'pending' && checkResult.underpaid && (
                      <p style={{ color: '#ffd700' }}>
                        ⏳ Найден платёж на {checkResult.receivedAmount}, но этого недостаточно — ждём остальное.
                      </p>
                    )}
                    {checkResult.status === 'pending' && !checkResult.underpaid && (
                      <p className="muted">⏳ Платёж пока не найден в блокчейне. Попробуй ещё раз через минуту.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h2>
              📋 Последние депозиты
              <button className="btn secondary" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={loadDeposits}>
                ⟳ Обновить
              </button>
            </h2>
            {listLoading && <p className="muted">Загрузка…</p>}
            {listError && <div className="error-box">⚠️ {listError}</div>}
            {sweepMessage && <div className="result-box" style={{ marginBottom: 10 }}><p className="muted">{sweepMessage}</p></div>}
            {!listLoading && deposits && deposits.length === 0 && (
              <div className="empty">Пока нет ни одного депозита</div>
            )}
            {!listLoading && deposits && deposits.length > 0 && (
              <table className="deposits">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Валюта</th>
                    <th>Сумма</th>
                    <th>К оплате</th>
                    <th>Адрес</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d) => (
                    <tr key={d.id}>
                      <td>#{d.id}</td>
                      <td>{CURRENCY_LABEL[d.currency]}</td>
                      <td>{d.amount_rub} ₽</td>
                      <td>{Number(d.expected_amount_crypto).toFixed(4)}</td>
                      <td className="mono" title={d.address || d.pay_url || ''}>{d.address || d.pay_url || '—'}</td>
                      <td><span className={`badge ${d.status}`}>{STATUS_LABEL[d.status]}</span></td>
                      <td>
                        {d.status === 'confirmed' && (
                          <button
                            className="btn secondary"
                            style={{ padding: '5px 10px', fontSize: 12 }}
                            onClick={() => sweepNow(d.id)}
                            disabled={sweepingId === d.id}
                          >
                            {sweepingId === d.id ? '…' : '📤 Свипнуть'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <button className="btn secondary" onClick={forgetToken}>Выйти (забыть токен)</button>
        </>
      )}
    </div>
  );
}
