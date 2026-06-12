create extension if not exists pg_net with schema extensions;

create schema if not exists supabase_functions;

create or replace function supabase_functions.http_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
  request_url text := tg_argv[0];
  request_method text := upper(tg_argv[1]);
  request_headers jsonb := jsonb_build_object('Content-Type', 'application/json')
    || coalesce(nullif(tg_argv[2], ''), '{}')::jsonb;
  request_params jsonb := coalesce(nullif(tg_argv[3], ''), '{}')::jsonb;
  request_timeout integer := coalesce(nullif(tg_argv[4], ''), '1000')::integer;
  request_body jsonb;
begin
  request_body := jsonb_build_object(
    'type', tg_op,
    'table', tg_table_name,
    'schema', tg_table_schema,
    'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
  );

  if request_method = 'POST' then
    select net.http_post(
      url := request_url,
      body := request_body,
      params := request_params,
      headers := request_headers,
      timeout_milliseconds := request_timeout
    ) into request_id;
  elsif request_method = 'GET' then
    select net.http_get(
      url := request_url,
      params := request_params || jsonb_build_object('payload', request_body::text),
      headers := request_headers,
      timeout_milliseconds := request_timeout
    ) into request_id;
  else
    raise exception 'Unsupported webhook HTTP method: %', request_method;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function supabase_functions.http_request() from public;
grant usage on schema supabase_functions to postgres;
grant execute on function supabase_functions.http_request() to postgres;
