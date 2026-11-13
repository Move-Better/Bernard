-- merge_staff gains brand_discovery_interviews as its 14th staff_id repoint.
--
-- brand_discovery_interviews.staff_id was added in migration 148 with
-- ON DELETE SET NULL, but merge_staff (112, extended in 191) never repointed
-- it. So merging a duplicate staff row kept the interview but dropped who gave
-- it (staff_id went NULL when the source row was deleted). Plain repoint: the
-- table has no staff_id-bearing unique index (only its pkey and a
-- (workspace_id, status) index; checked in prod 2026-11-12).
--
-- Body is the live pg_get_functiondef as of 2026-11-12 with one line added.
-- CREATE OR REPLACE needs the whole body.
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

  delete from staff where id = p_source;
end;
$function$;

grant execute on function public.merge_staff(uuid, uuid, uuid) to service_role;
