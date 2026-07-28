-- PC access, Phase B: allow the run_action job kind.
--
-- What an action IS stays defined in pc-agent/actions.json on the PC —
-- the database only ever carries the action's name. Widening this check
-- is the entire cloud-side schema change.
--
-- Apply with: npm run db:migrate

alter table public.pc_jobs drop constraint if exists pc_jobs_kind_check;
alter table public.pc_jobs add constraint pc_jobs_kind_check
  check (kind in ('list_dir', 'read_file', 'search_files', 'run_action'));
