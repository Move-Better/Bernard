-- 124_drop_pinterest_boards.sql
-- Retire Pinterest entirely. No workspace uses it; the channel and its
-- per-workspace board-names config string are removed from the app in the same
-- PR. This migration drops the now-dead column and strips the stale 'pinterest'
-- entry from any workspace's enabled_outputs array so the publishing surfaces
-- no longer offer it.
--
-- Self-contained per the migration conventions. No new objects are created, so
-- no GRANTs are needed. Idempotent: re-applying is a no-op.

-- Strip 'pinterest' from enabled_outputs first (the channel no longer exists in
-- src/lib/outputChannels.js, so a stale array entry is inert, but clean it up).
update public.workspaces
set enabled_outputs = array_remove(enabled_outputs, 'pinterest')
where 'pinterest' = any(enabled_outputs);

-- Drop the per-workspace Pinterest board-names config string.
alter table public.workspaces drop column if exists pinterest_boards;
