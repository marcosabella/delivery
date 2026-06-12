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

  begin
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
  exception when others then
    raise warning 'Database webhook failed for %.%: %', tg_table_schema, tg_table_name, sqlerrm;
  end;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function supabase_functions.http_request() from public;
grant usage on schema supabase_functions to postgres;
grant execute on function supabase_functions.http_request() to postgres;

create or replace function public.register_push_subscription(
  subscription_endpoint text,
  subscription_p256dh text,
  subscription_auth text,
  subscription_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(subscription_endpoint, '') = ''
    or coalesce(subscription_p256dh, '') = ''
    or coalesce(subscription_auth, '') = '' then
    raise exception 'Invalid push subscription';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (
    current_user_id,
    subscription_endpoint,
    subscription_p256dh,
    subscription_auth,
    subscription_user_agent
  )
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    updated_at = now();
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
