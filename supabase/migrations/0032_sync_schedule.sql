-- 0032_sync_schedule.sql
-- Schedules the hourly sync tick. Once an hour, at minute 7, Supabase Cron asks pg_net to post to
-- the connections function's /sync/tick; the function works out which sources are due from each
-- source's own weekday, time and time zone, so nothing about any company's schedule lives here.
--
-- Paste after 0031 and after the two Vault entries exist; idempotent. The function's URL
-- (sync_function_url) and the shared secret (sync_cron_secret, the same value as the function's
-- SYNC_CRON_SECRET) live in Vault by name and never in this file; the job reads them each time
-- it runs. Neither extension is installed on the live project today; this installs both.
--
-- Accepted trade-off: pg_net keeps the decrypted header in its request queue until the request is
-- sent. The cron secret can only start a sync, never read or change anything.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Unschedule first, so pasting this again leaves exactly one job.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'hub-sync-tick') then
    perform cron.unschedule('hub-sync-tick');
  end if;
end $$;

select cron.schedule(
  'hub-sync-tick',
  '7 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  $job$
);
