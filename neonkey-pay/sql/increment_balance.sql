-- Атомарное начисление баланса пользователю основного Mini App.
--
-- ВАЖНО — ПРОВЕРЬ ПЕРЕД ЗАПУСКОМ: значения по умолчанию для avatar/orders/
-- consent ниже основаны на том, что использует webapp/js/api/profile.js
-- в основном проекте (avatar: '👤', orders: [] в jsonb, consent: false).
-- Если у тебя в таблице users эти колонки называются иначе или другого
-- типа — поправь под реальную структуру, иначе INSERT-часть (на случай
-- НОВОГО пользователя, у которого ещё нет строки в users) может упасть.
--
-- Атомарность важна, чтобы не потерять деньги при одновременном вызове
-- (например, cron-воркер и ручная кнопка "Проверить" сработали почти
-- одновременно на один и тот же депозит) — "select balance, потом update"
-- в коде сервиса было бы гонкой состояний, а один SQL-запрос — нет.

create or replace function increment_balance(p_user_id bigint, p_amount numeric)
returns void as $$
begin
  insert into users (user_id, balance, avatar, orders, consent)
  values (p_user_id, p_amount, '👤', '[]'::jsonb, false)
  on conflict (user_id) do update
    set balance = users.balance + excluded.balance;
end;
$$ language plpgsql;

-- Выполняется через SUPABASE_SERVICE_ROLE_KEY (обходит RLS), вызывается
-- только из pages/api/payments/check.ts этого сервиса — из основного
-- Mini App (который ходит anon-ключом) вызвать эту функцию напрямую
-- нельзя, и не нужно.
