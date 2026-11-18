-- Removes the account tables and their helper functions so you can start clean.
-- The characters table and its rows are NOT touched.
-- Run in the Supabase SQL Editor.

drop table if exists public.audit_log;
drop table if exists public.prestige_history;
drop table if exists public.avatar_progress;
drop table if exists public.equipped_avatar;
drop table if exists public.favorites;          -- old name from the first version, harmless if missing
drop table if exists public.users;
drop table if exists public.roles;

drop function if exists public.record_failed_login(bigint, integer, integer);
drop function if exists public.record_successful_login(bigint);
drop function if exists public.change_password(bigint, text);
drop function if exists public.revoke_tokens(bigint);
drop function if exists public.equip_avatar(bigint, bigint);
drop function if exists public.level_up_avatar(bigint, integer);
drop function if exists public.add_avatar_xp(bigint, integer, integer);
drop function if exists public.avatar_level_for_xp(integer);
drop function if exists public.avatar_level_for_xp(integer, integer, integer, integer);
drop function if exists public.add_avatar_xp(bigint, integer, integer, integer, integer, integer, integer);
drop function if exists public.prestige_avatar(bigint, integer, integer);
drop function if exists public.protect_last_admin();
-- set_updated_at() is shared with the characters table, so it is NOT dropped.

-- Check: should return only 'characters'
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
