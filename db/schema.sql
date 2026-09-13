-- Mudalali schema. Run once: npm run db:setup

create table if not exists customers (
  id            serial primary key,
  wa_jid        text unique not null,
  phone         text,
  name          text,
  city          text,
  created_at    timestamptz not null default now()
);

create table if not exists conversations (
  id              serial primary key,
  customer_id     int not null references customers(id) on delete cascade,
  status          text not null default 'open',      -- open | closed
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists conversations_customer_idx on conversations (customer_id, status);

-- Every message, inbound and outbound, with what the model predicted.
-- This table is the eventual test set. Never prune it.
create table if not exists messages (
  id              bigserial primary key,
  conversation_id int not null references conversations(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  body            text not null,
  intent          text,
  confidence      real,
  entities        jsonb,
  needs_human     boolean,
  language        text,
  media_kind      text,                              -- image | audio | null
  model           text,
  latency_ms      int,
  wa_message_id   text,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx on messages (conversation_id, id desc);
-- WhatsApp redelivers on reconnect with the same id. This is what stops a
-- customer being answered twice and the model being paid for twice.
create unique index if not exists messages_wa_id_idx on messages (wa_message_id);
create index if not exists messages_intent_idx on messages (intent) where direction = 'in';

create table if not exists catalog (
  id          text primary key,
  name        text not null,
  name_si     text,
  price_lkr   integer not null,
  sizes       text[] not null default '{}',
  colours     text[] not null default '{}',
  stock       integer not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists orders (
  id                serial primary key,
  customer_id       int not null references customers(id) on delete cascade,
  conversation_id   int references conversations(id) on delete set null,
  status            text not null default 'draft',   -- draft | confirmed | shipped | cancelled
  customer_name     text,
  phone             text,
  city              text,
  address           text,
  delivery_fee_lkr  int,
  total_lkr         int,
  created_at        timestamptz not null default now()
);

create table if not exists order_items (
  id              serial primary key,
  order_id        int not null references orders(id) on delete cascade,
  product_id      text references catalog(id),
  size            text,
  colour          text,
  quantity        int not null default 1,
  unit_price_lkr  int not null
);

-- Suggest-only mode: drafts waiting for the operator to approve.
create table if not exists pending_drafts (
  id              text primary key,                  -- short code, e.g. 'a3f'
  conversation_id int not null references conversations(id) on delete cascade,
  customer_jid    text not null,
  incoming_body   text not null,
  draft_reply     text not null,
  intent          text,
  order_id        int references orders(id) on delete set null,
  status          text not null default 'pending',   -- pending | sent | edited | skipped
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists pending_drafts_status_idx on pending_drafts (status, created_at);

-- Settings the shop owner can change at runtime. The agent overlays these on
-- top of the .env defaults and re-reads them every few seconds, so the admin
-- console can flip a switch without restarting or redeploying anything.
create table if not exists settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Additive migrations. Safe to re-run: `npm run db:setup` applies this whole
-- file, and `create table if not exists` alone never adds a new column to a
-- table that already exists.
alter table messages add column if not exists media_kind text;
alter table orders   add column if not exists customer_name text;
alter table orders   add column if not exists phone text;
alter table pending_drafts add column if not exists order_id int references orders(id) on delete set null;

-- When a decision was actually put on the wire. The WhatsApp command path sends
-- immediately and stamps this; the admin console only records the decision, so
-- it leaves this null and the agent's outbox picks the row up.
alter table pending_drafts add column if not exists delivered_at timestamptz;

-- Rows resolved before this column existed were already delivered over
-- WhatsApp. Without this backfill the outbox would re-send every one of them.
update pending_drafts
   set delivered_at = resolved_at
 where delivered_at is null
   and status in ('sent', 'edited')
   and resolved_at is not null;

create index if not exists pending_drafts_outbox_idx
  on pending_drafts (status, delivered_at) where delivered_at is null;
