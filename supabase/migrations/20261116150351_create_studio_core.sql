-- Private, owner-scoped foundation for resumable Studio Director jobs.
-- Store metadata and checkpoints only; do not put provider keys or full repo ZIPs here.

create table if not exists public.studio_jobs (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (char_length(title) between 1 and 200),
    brief text not null check (char_length(brief) between 1 and 4000),
    market text not null default 'India + worldwide'
        check (market in ('India', 'Worldwide', 'India + worldwide')),
    status text not null default 'queued'
        check (status in ('queued', 'planning', 'running', 'needs_approval', 'paused', 'completed', 'failed', 'cancelled')),
    workstreams jsonb not null default '[]'::jsonb,
    plan jsonb not null default '{}'::jsonb,
    checkpoint jsonb not null default '{}'::jsonb,
    attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
    max_attempts smallint not null default 3 check (max_attempts between 1 and 3),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (id, owner_id)
);

create table if not exists public.studio_job_events (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null,
    owner_id uuid not null references auth.users(id) on delete cascade,
    event_type text not null check (char_length(event_type) between 1 and 80),
    summary text not null check (char_length(summary) <= 1200),
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    foreign key (job_id, owner_id) references public.studio_jobs(id, owner_id) on delete cascade
);

create table if not exists public.studio_approvals (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null,
    owner_id uuid not null references auth.users(id) on delete cascade,
    action_type text not null
        check (action_type in ('client_contact', 'production_deploy', 'device_action', 'cloud_write', 'cloud_delete')),
    summary text not null check (char_length(summary) between 1 and 1200),
    action_preview jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
    requested_at timestamptz not null default now(),
    expires_at timestamptz,
    decided_at timestamptz,
    foreign key (job_id, owner_id) references public.studio_jobs(id, owner_id) on delete cascade
);

-- Store Drive references and review metadata, never the ZIP contents or credentials.
create table if not exists public.studio_repo_sources (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    drive_file_id text not null check (char_length(drive_file_id) between 1 and 256),
    drive_parent_id text,
    repo_name text not null check (char_length(repo_name) between 1 and 240),
    source_url text,
    license_id text,
    revision text,
    review_status text not null default 'unreviewed'
        check (review_status in ('unreviewed', 'metadata_indexed', 'statically_reviewed', 'approved_for_reference', 'rejected')),
    enabled_for_reference boolean not null default false,
    review_summary text check (char_length(review_summary) <= 4000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, drive_file_id)
);

create index if not exists studio_jobs_owner_created_idx on public.studio_jobs (owner_id, created_at desc);
create index if not exists studio_jobs_owner_status_idx on public.studio_jobs (owner_id, status, updated_at desc);
create index if not exists studio_events_job_created_idx on public.studio_job_events (owner_id, job_id, created_at desc);
create index if not exists studio_approvals_owner_status_idx on public.studio_approvals (owner_id, status, requested_at desc);
create index if not exists studio_repo_sources_owner_name_idx on public.studio_repo_sources (owner_id, repo_name);

alter table public.studio_jobs enable row level security;
alter table public.studio_job_events enable row level security;
alter table public.studio_approvals enable row level security;
alter table public.studio_repo_sources enable row level security;

revoke all on public.studio_jobs, public.studio_job_events, public.studio_approvals, public.studio_repo_sources from anon, public;
grant select, insert, update, delete on public.studio_jobs to authenticated;
grant select, insert on public.studio_job_events to authenticated;
grant select, insert, update on public.studio_approvals to authenticated;
grant select, insert, update, delete on public.studio_repo_sources to authenticated;

drop policy if exists studio_jobs_owner_access on public.studio_jobs;
create policy studio_jobs_owner_access on public.studio_jobs
    for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists studio_job_events_owner_read on public.studio_job_events;
create policy studio_job_events_owner_read on public.studio_job_events
    for select to authenticated using (owner_id = auth.uid());
drop policy if exists studio_job_events_owner_insert on public.studio_job_events;
create policy studio_job_events_owner_insert on public.studio_job_events
    for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists studio_approvals_owner_access on public.studio_approvals;
create policy studio_approvals_owner_access on public.studio_approvals
    for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists studio_repo_sources_owner_access on public.studio_repo_sources;
create policy studio_repo_sources_owner_access on public.studio_repo_sources
    for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
