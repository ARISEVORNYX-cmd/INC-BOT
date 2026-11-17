-- Private, owner-scoped chat memory for Personal Ari.
-- The schema can be provisioned before Auth; do not enable app use until the owner-only Supabase Auth flow is configured and verified.
create table if not exists public.ari_conversations (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'New chat'
        check (char_length(title) between 1 and 160),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, owner_id)
);

create table if not exists public.ari_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null,
    owner_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null check (char_length(content) between 1 and 12000),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    foreign key (conversation_id, owner_id)
        references public.ari_conversations(id, owner_id) on delete cascade
);

create index if not exists ari_conversations_owner_updated_idx
    on public.ari_conversations (owner_id, updated_at desc);
create index if not exists ari_messages_owner_conversation_created_idx
    on public.ari_messages (owner_id, conversation_id, created_at asc);

alter table public.ari_conversations enable row level security;
alter table public.ari_messages enable row level security;

revoke all on public.ari_conversations, public.ari_messages from anon, public, authenticated;
grant select, insert, update, delete on public.ari_conversations to authenticated;
grant select, insert, delete on public.ari_messages to authenticated;

create policy ari_conversations_owner_select on public.ari_conversations
    for select to authenticated using (owner_id = auth.uid());
create policy ari_conversations_owner_insert on public.ari_conversations
    for insert to authenticated with check (owner_id = auth.uid());
create policy ari_conversations_owner_update on public.ari_conversations
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ari_conversations_owner_delete on public.ari_conversations
    for delete to authenticated using (owner_id = auth.uid());

create policy ari_messages_owner_select on public.ari_messages
    for select to authenticated using (owner_id = auth.uid());
create policy ari_messages_owner_insert on public.ari_messages
    for insert to authenticated with check (owner_id = auth.uid());
create policy ari_messages_owner_delete on public.ari_messages
    for delete to authenticated using (owner_id = auth.uid());
