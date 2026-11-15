-- media_assets.pictured_patient: a patient is in the photo. A flag, not a
-- person: patients get no name or id. Together with pictured_staff_ids it says
-- a photo has been looked at (a photo of a patient alone is a valid answer to
-- "who is in this?"), so it leaves the Library's Needs people worklist.
alter table public.media_assets
  add column if not exists pictured_patient boolean not null default false;
