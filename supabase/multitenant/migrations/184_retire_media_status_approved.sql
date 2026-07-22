-- 184_retire_media_status_approved.sql
--
-- Retire media_assets.status = 'approved' (and formalise 'rendered', already
-- removed from the UI/API in #2273). The live vocabulary is now exactly:
--
--   raw | tagged | archived
--
-- Why: 'approved' looked like a publish gate and was not one. Nothing in the
-- suggestion, attach or publish path ever read it — match_visual_memory_chunks
-- has never filtered on status at all — but the Library filter labelled it
-- "Approved — cleared to publish", which implied the other 1,418 assets were
-- not cleared. Four writers set it (exportClipEngine, saveBroll,
-- recordUploadedAsset on brief return-uploads, media/[id]/edit on variants),
-- all meaning "derived asset, already finished, skip auto-tagging" — which is
-- precisely what 'tagged' already means. Those four now write 'tagged'.
--
-- 'rendered' needed no data change: nothing ever wrote it to media_assets (the
-- only status:'rendered' writer in the codebase targets video_segments, a
-- different table) and prod held zero such rows.
--
-- No constraint work: media_assets.status is plain `status text default 'raw'`
-- (001_init.sql) with no CHECK. The allowlist is enforced in the API layer
-- (api/_routes/media/list.js, api/_routes/media/[id].js), both updated.
--
-- Data change: 15 rows on movebetter, all videos, all finished cuts or
-- moments/edit exports. Recorded here so the change is reversible:
--
--   9d4841d4-0173-487e-b7c9-0f18172d4120  Melanie Final Cut.mp4
--   820e040f-b033-479b-9f09-ef4e9f41e269  Chasta Final Cut.mp4
--   647aecbc-52ee-4e83-b0d1-e2a4ed72ed8b  Q_TurkishGetup_L.MP4
--   baf1d9a6-a16f-40dc-bad2-028b37afa47c  Deloading_11_24 (moments)
--   13612b52-d038-47fe-a5d2-7659fd2379ee  Deloading_11_24 (moments)
--   d91ad8b7-9cd4-49b0-803a-d01ac894fb55  Deloading_11_24 (moments)
--   fbfd6041-d333-4071-9783-8f3a59a2edd6  instagram_reel-C0111.mp4
--   25c98e34-c2b2-481d-a0e7-e3f515dac330  instagram_reel-IMG_4272.mp4
--   a63e6f6f-7263-4190-9200-08efce8d52b3  Darian Recut.mp4
--   3d2024ef-84b5-415d-b19a-04ccd8474bb7  Aaron Final Cut.mp4
--   daf80d88-a403-45be-a296-0ef9db041c2b  instagram_reel-IMG_5338.mp4
--   031db75a-8cb9-469b-8978-6f406f725015  C0091-clip.mp4
--   85535d9b-d7c8-49e4-9972-f4f9bce828a4  Move_Better_v2.mp4
--   f6bfe7da-2f92-45fd-a1ac-d4f999d1fef6  Melanie_Final_Cut.mp4
--   eb336f26-5a7d-4ad6-a95e-2c6e2cda3a8c  Melanie_Final_Cut.mp4
--
-- To reverse: UPDATE public.media_assets SET status = 'approved'
--             WHERE id IN (<the 15 ids above>);
--
-- Idempotent: re-running matches zero rows.

UPDATE public.media_assets
   SET status = 'tagged'
 WHERE status = 'approved';

-- Belt and braces: 'rendered' should not exist on this table, but if a row
-- ever appeared it would now render under the neutral 'raw' fallback with no
-- way to filter to it. Normalise any stray row to the same ready state.
UPDATE public.media_assets
   SET status = 'tagged'
 WHERE status = 'rendered';
