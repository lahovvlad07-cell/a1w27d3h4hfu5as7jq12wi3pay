-- Таблица депозитов (пополнений баланса через крипту).
-- id используется напрямую как индекс деривации адреса — поэтому
-- сначала вставляем строку (без адреса), получаем id, затем этим же
-- запросом обновляем address/wallet_id. См. pages/api/payments/create.ts.

create table if not exists deposits (
  id bigserial primary key,
  user_id bigint not null,
  currency text not null check (currency in ('USDT_TRC20', 'TRX', 'TON', 'CRYPTOBOT', 'XROCKET')),
  address text,
  wallet_id bigint, -- только для TON (walletId), для TRON остаётся null
  invoice_id text,  -- только для CRYPTOBOT/XROCKET — id инвойса у провайдера
  pay_url text,     -- только для CRYPTOBOT/XROCKET — ссылка на оплату инвойса
  amount_rub numeric not null,
  rate_used numeric not null,              -- курс, зафиксированный в момент создания
  gross_amount_crypto numeric not null default 0, -- сумма по курсу, без комиссии
  commission_crypto numeric not null default 0,   -- фиксированная комиссия сети сверху
  expected_amount_crypto numeric not null, -- сколько крипты должно прийти (gross + commission)
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'expired', 'swept')),
  tx_hash text,                          -- хэш входящей транзакции (оплата от пользователя)
  sweep_tx_hash text,                    -- хэш/метка исходящей транзакции свипа на казначейский кошелёк
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- Если таблица уже была создана раньше (до появления комиссии/свипа/
-- CryptoBot/xRocket) — этот блок безопасно доводит её до актуальной
-- структуры повторным запуском файла.
alter table deposits add column if not exists gross_amount_crypto numeric not null default 0;
alter table deposits add column if not exists commission_crypto numeric not null default 0;
alter table deposits add column if not exists sweep_tx_hash text;
alter table deposits add column if not exists invoice_id text;
alter table deposits add column if not exists pay_url text;

-- Расширяем check-constraint на currency, если таблица создавалась ДО
-- появления CRYPTOBOT/XROCKET (когда create table if not exists выше
-- уже не сработает на старую таблицу со старым constraint'ом).
do $$
begin
  alter table deposits drop constraint if exists deposits_currency_check;
  alter table deposits add constraint deposits_currency_check
    check (currency in ('USDT_TRC20', 'TRX', 'TON', 'CRYPTOBOT', 'XROCKET'));
exception when others then
  raise notice 'Не удалось обновить deposits_currency_check: %', SQLERRM;
end $$;

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
