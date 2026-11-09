-- 0030_sync_schedule.test.sql
-- Proves the hourly sync tick (0030): exactly one job even after the migration is pasted twice,
-- hourly at minute 7, the function's URL and the cron secret read from Vault by name and never
-- written into the job, and the job's command posts to that URL with that secret.
--
-- Runs inside one transaction the harness opens and rolls back; never begin or commit here.

-- case: job_scheduled_once
do $$
begin
  perform tests.assert(
    (select count(*) from cron.job where jobname = 'hub-sync-tick') = 1,
    'job_scheduled_once: there is not exactly one hub-sync-tick job after 0030 ran twice'
  );
end $$;

-- case: hourly_at_minute_seven
do $$
begin
  perform tests.assert(
    (select schedule from cron.job where jobname = 'hub-sync-tick') = '7 * * * *',
    'hourly_at_minute_seven: the job does not run at minute 7 of every hour'
  );
end $$;

-- case: secrets_read_from_vault_by_name
do $$
declare
  cmd text := (select command from cron.job where jobname = 'hub-sync-tick');
begin
  perform tests.assert(cmd like '%vault.decrypted_secrets%',
    'secrets_read_from_vault_by_name: the job does not read vault.decrypted_secrets');
  perform tests.assert(cmd like '%''sync_function_url''%',
    'secrets_read_from_vault_by_name: the job does not read sync_function_url by name');
  perform tests.assert(cmd like '%''sync_cron_secret''%',
    'secrets_read_from_vault_by_name: the job does not read sync_cron_secret by name');
  perform tests.assert(cmd like '%x-sync-secret%',
    'secrets_read_from_vault_by_name: the job does not send the x-sync-secret header');
end $$;

-- case: no_url_or_secret_in_job
do $$
declare
  cmd text := (select command from cron.job where jobname = 'hub-sync-tick');
begin
  perform tests.assert(cmd not like '%https://%',
    'no_url_or_secret_in_job: the job carries a URL');
  perform tests.assert(cmd not like '%supabase.co%',
    'no_url_or_secret_in_job: the job carries a project address');
end $$;

-- case: command_runs
select vault.create_secret('sample-cron-secret', 'sync_cron_secret');
select vault.create_secret('https://example.supabase.co/functions/v1/connections/sync/tick', 'sync_function_url');
do $$
declare
  req record;
begin
  execute (select command from cron.job where jobname = 'hub-sync-tick');
  select url, headers into req from net.requests order by id desc limit 1;
  perform tests.assert(req.url = 'https://example.supabase.co/functions/v1/connections/sync/tick',
    'command_runs: the job did not post to the URL in Vault');
  perform tests.assert(req.headers ->> 'x-sync-secret' = 'sample-cron-secret',
    'command_runs: the job did not send the secret in Vault');
end $$;
