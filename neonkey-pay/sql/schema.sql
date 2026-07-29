-- Таблица депозитов (пополнений баланса через крипту).
-- id используется напрямую как индекс деривации адреса — поэтому
-- сначала вставляем строку (без адреса), получаем id, затем этим же
-- запросом обновляем address/wallet_id. См. pages/api/payments/create.ts.

create table if not exists deposits (
  id bigserial primary key,
  user_id bigint not null,
  currency text not null check (currency in ('USDT_TRC20', 'TRX', 'TON')),
  address text,
  wallet_id bigint, -- только для TON (walletId), для TRON остаётся null
  amount_rub numeric not null,
  rate_used numeric not null,           -- курс, зафиксированный в момент создания
  expected_amount_crypto numeric not null, -- сколько крипты должно прийти
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'expired', 'swept')),
  tx_hash text,                          -- хэш входящей транзакции, когда найдена
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists deposits_status_idx on deposits (status);
create index if not exists deposits_address_idx on deposits (address);
create index if not exists deposits_user_id_idx on deposits (user_id);

-- Этот сервис обращается к базе через SERVICE ROLE ключ (см.
-- lib/supabaseAdmin.ts), который полностью обходит RLS — поэтому
-- отдельные RLS-политики для anon на эту таблицу не нужны и не должны
-- создаваться: снаружи (из основного Mini App) к ней вообще не должно
-- быть прямого доступа, только через API-эндпоинты этого сайта.
alter table deposits enable row level security;
-- Явно не создаём ни одной policy — значит доступ по anon-ключу к этой
-- таблице закрыт полностью (только service_role может её читать/писать).
