export default function Home() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 40, color: '#eee', background: '#0a0e1a', minHeight: '100vh' }}>
      <h1>NeonKey Pay</h1>
      <p>Внутренний платёжный сервис. Публичного интерфейса здесь пока нет —</p>
      <p>API: <code>POST /api/payments/create</code></p>
      <p>Дашборд для вывода средств появится здесь в следующей итерации.</p>
    </main>
  );
}
