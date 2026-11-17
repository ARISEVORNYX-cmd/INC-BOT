-- Revoke inherited default table privileges and restore least-privilege access.
-- These are new Studio-owned tables only; no existing application data is changed.
revoke all on public.studio_jobs, public.studio_job_events, public.studio_approvals, public.studio_repo_sources from anon, public, authenticated;

grant select, insert, update on public.studio_jobs to authenticated;
grant select, insert on public.studio_job_events to authenticated;
grant select, insert, update on public.studio_approvals to authenticated;
grant select, insert, update on public.studio_repo_sources to authenticated;

drop policy if exists studio_jobs_owner_access on public.studio_jobs;
create policy studio_jobs_owner_read on public.studio_jobs
    for select to authenticated using (owner_id = auth.uid());
create policy studio_jobs_owner_insert on public.studio_jobs
    for insert to authenticated with check (owner_id = auth.uid());
create policy studio_jobs_owner_update on public.studio_jobs
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists studio_approvals_owner_access on public.studio_approvals;
create policy studio_approvals_owner_read on public.studio_approvals
    for select to authenticated using (owner_id = auth.uid());
create policy studio_approvals_owner_insert on public.studio_approvals
    for insert to authenticated with check (owner_id = auth.uid());
create policy studio_approvals_owner_update on public.studio_approvals
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists studio_repo_sources_owner_access on public.studio_repo_sources;
create policy studio_repo_sources_owner_read on public.studio_repo_sources
    for select to authenticated using (owner_id = auth.uid());
create policy studio_repo_sources_owner_insert on public.studio_repo_sources
    for insert to authenticated with check (owner_id = auth.uid());
create policy studio_repo_sources_owner_update on public.studio_repo_sources
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
