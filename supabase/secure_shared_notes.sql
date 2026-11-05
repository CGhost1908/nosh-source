-- Secure shared_notes publishing
-- Run once in Supabase Dashboard > SQL Editor.
--
-- Before: anon had UPDATE on every row (USING (true)), so anyone holding the
-- public anon key could overwrite any shared note.
-- After: each published note gets a secret edit token. Only its SHA-256 hash is
-- stored, and updates go through update_shared_note(), which checks the token.

create extension if not exists pgcrypto with schema extensions;

alter table public.shared_notes
    add column if not exists edit_token_hash text;

-- 1. Close the open UPDATE / DELETE hole
drop policy if exists "Allow anon update" on public.shared_notes;
revoke update, delete on public.shared_notes from anon, authenticated;

-- 2. Never expose edit_token_hash through the REST API
revoke select on public.shared_notes from anon, authenticated;
grant select (id, title, content, created_at) on public.shared_notes to anon, authenticated;

-- 3. Publish a new note together with its edit token hash
create or replace function public.publish_shared_note(
    p_id text,
    p_title text,
    p_content text,
    p_edit_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if p_id is null or p_id !~ '^[A-Za-z0-9]{12,64}$' then
        raise exception 'invalid note id';
    end if;
    if p_edit_token is null or length(p_edit_token) < 32 then
        raise exception 'invalid edit token';
    end if;
    if length(coalesce(p_title, '')) > 200 then
        raise exception 'title too long';
    end if;
    if length(coalesce(p_content, '')) > 2000000 then
        raise exception 'content too large';
    end if;

    insert into public.shared_notes (id, title, content, edit_token_hash)
    values (p_id, p_title, p_content, encode(digest(p_edit_token, 'sha256'), 'hex'));

    return true;
end;
$$;

-- 4. Update a note only when the caller knows its edit token.
--    Returns false for a wrong token or for legacy notes published without one.
create or replace function public.update_shared_note(
    p_id text,
    p_edit_token text,
    p_title text,
    p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_count integer;
begin
    if p_edit_token is null or length(p_edit_token) < 32 then
        return false;
    end if;
    if length(coalesce(p_title, '')) > 200 then
        raise exception 'title too long';
    end if;
    if length(coalesce(p_content, '')) > 2000000 then
        raise exception 'content too large';
    end if;

    update public.shared_notes
       set title = p_title,
           content = p_content
     where id = p_id
       and edit_token_hash is not null
       and edit_token_hash = encode(digest(p_edit_token, 'sha256'), 'hex');

    get diagnostics v_count = row_count;
    return v_count = 1;
end;
$$;

revoke all on function public.publish_shared_note(text, text, text, text) from public;
revoke all on function public.update_shared_note(text, text, text, text) from public;
grant execute on function public.publish_shared_note(text, text, text, text) to anon, authenticated;
grant execute on function public.update_shared_note(text, text, text, text) to anon, authenticated;

-- Optional, once every user runs a Nosh version that publishes through
-- publish_shared_note(): stop direct inserts as well.
-- revoke insert on public.shared_notes from anon, authenticated;
