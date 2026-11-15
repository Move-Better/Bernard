-- media_assets.pictured_staff_ids: who is PICTURED in a photo (many people),
-- distinct from staff_id (the single attributed clinician that drives video
-- voice, captions and the visual-memory index) and created_by (who uploaded).
--
-- No backfill here: staff_id stays as it is. A one-time copy of the 11 live
-- photos that still carry a hand-picked staff_id is run separately, by hand.
-- merge_staff must rewrite the new array too, or a merge would leave a deleted
-- staff id behind. Body is the live pg_get_functiondef as of 2026-11-15
-- (identical to migration 218) plus the one block marked NEW.
alter table public.media_assets
  add column if not exists pictured_staff_ids uuid[] not null default '{}';

create index if not exists media_assets_pictured_staff_ids_idx
  on public.media_assets using gin (pictured_staff_ids);

create or replace function public.merge_staff(p_source uuid, p_target uuid, p_workspace uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_src_ws uuid;
  v_tgt_ws uuid;
begin
  if p_source = p_target then
    raise exception 'merge_staff: source and target are identical (%)', p_source;
  end if;

  select workspace_id into v_src_ws from staff where id = p_source;
  select workspace_id into v_tgt_ws from staff where id = p_target;
  if v_src_ws is null then raise exception 'merge_staff: source % not found', p_source; end if;
  if v_tgt_ws is null then raise exception 'merge_staff: target % not found', p_target; end if;
  if v_src_ws <> p_workspace or v_tgt_ws <> p_workspace then
    raise exception 'merge_staff: cross-workspace merge blocked (src ws %, tgt ws %, expected %)',
      v_src_ws, v_tgt_ws, p_workspace;
  end if;

  delete from staff_voice_phrases s
   where s.staff_id = p_source
     and exists (
       select 1 from staff_voice_phrases t
        where t.staff_id = p_target
          and t.phrase_normalized = s.phrase_normalized
     );
  update staff_voice_phrases set staff_id = p_target where staff_id = p_source;

  delete from staff_corpus_documents s
   where s.staff_id = p_source
     and s.archived_at is null
     and exists (
       select 1 from staff_corpus_documents t
        where t.staff_id = p_target
          and t.archived_at is null
          and t.doc_type = s.doc_type
          and t.title = s.title
     );
  update staff_corpus_documents set staff_id = p_target where staff_id = p_source;

  if exists (select 1 from staff_recipes where staff_id = p_target and is_default) then
    update staff_recipes set is_default = false where staff_id = p_source and is_default;
  end if;
  delete from staff_recipes s
   where s.staff_id = p_source
     and exists (
       select 1 from staff_recipes t
        where t.staff_id = p_target
          and lower(t.name) = lower(s.name)
     );
  update staff_recipes set staff_id = p_target where staff_id = p_source;

  update brand_discovery_interviews      set staff_id = p_target where staff_id = p_source;
  update concept_mentions                set staff_id = p_target where staff_id = p_source;
  update content_items                   set staff_id = p_target where staff_id = p_source;
  update interviews                      set staff_id = p_target where staff_id = p_source;
  update media_assets                    set staff_id = p_target where staff_id = p_source;
  update moments                         set staff_id = p_target where staff_id = p_source;
  update practice_memory_chunks          set staff_id = p_target where staff_id = p_source;
  update story_packages                  set staff_id = p_target where staff_id = p_source;
  update video_segments                  set staff_id = p_target where staff_id = p_source;
  update visual_memory_chunks            set staff_id = p_target where staff_id = p_source;
  update workspace_onboarding_interviews set staff_id = p_target where staff_id = p_source;

  update campaigns
     set target_staff_ids = (
       select array(select distinct x
                      from unnest(array_replace(target_staff_ids, p_source, p_target)) as x)
     )
   where p_source = any(target_staff_ids);

  -- NEW (220): pictured_staff_ids is an array, so rewrite it like target_staff_ids.
  update media_assets
     set pictured_staff_ids = (
       select array(select distinct x
                      from unnest(array_replace(pictured_staff_ids, p_source, p_target)) as x)
     )
   where p_source = any(pictured_staff_ids);

  delete from staff where id = p_source;
end;
$function$;

grant execute on function public.merge_staff(uuid, uuid, uuid) to service_role;
