-- Moves an EXISTING database to the XP leveling system. Safe to run more than once.
-- Run this in the Supabase SQL Editor if you already ran accounts.sql before.
-- (A fresh install does not need it: accounts.sql already includes everything.)
--
-- What changes:
--   * equipped_avatar gets an xp column, and level may now be 0
--   * existing avatars get xp = wins x 50, and their level is recalculated from that
--     (the old system gave +1 level per win, so many levels will go DOWN; that is expected)
--   * old function level_up_avatar is replaced by add_avatar_xp

alter table public.equipped_avatar add column if not exists xp integer not null default 0;
alter table public.equipped_avatar drop constraint if exists equipped_avatar_xp_check;
alter table public.equipped_avatar add constraint equipped_avatar_xp_check check (xp >= 0);
alter table public.equipped_avatar drop constraint if exists equipped_avatar_level_check;
alter table public.equipped_avatar add constraint equipped_avatar_level_check check (level >= 0);
alter table public.equipped_avatar alter column level set default 0;

-- ============ avatar functions ============
-- Leveling rules: every win gives XP (the API sends 50).
--   Level 1 needs 100 XP, and each next level needs 1.25 times the XP of the level before:
--   100, 125, 156, 195, 244 ... (each amount rounded down). XP carries over, nothing is lost.
create or replace function public.avatar_level_for_xp(p_xp integer)
returns integer
language plpgsql immutable set search_path = public as $$
declare
  v_level integer := 0;
  v_left  numeric := greatest(p_xp, 0);
  v_need  numeric := 100;
begin
  while v_left >= floor(v_need) loop
    v_left  := v_left - floor(v_need);
    v_level := v_level + 1;
    v_need  := v_need * 1.25;
  end loop;
  return v_level;
end;
$$;

-- Equips a character. If the user already has an avatar it is REPLACED (never a second row).
-- Re-equipping the same character keeps its XP and level; a different character starts at 0 XP, level 0.
create or replace function public.equip_avatar(p_user_id bigint, p_character_id bigint)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_row public.equipped_avatar;
begin
  insert into public.equipped_avatar (user_id, character_id)
  values (p_user_id, p_character_id)
  on conflict (user_id) do update set
    xp          = case when equipped_avatar.character_id = excluded.character_id
                       then equipped_avatar.xp else 0 end,
    level       = case when equipped_avatar.character_id = excluded.character_id
                       then equipped_avatar.level else 0 end,
    wins        = case when equipped_avatar.character_id = excluded.character_id
                       then equipped_avatar.wins else 0 end,
    last_win_at = case when equipped_avatar.character_id = excluded.character_id
                       then equipped_avatar.last_win_at else null end,
    equipped_at = case when equipped_avatar.character_id = excluded.character_id
                       then equipped_avatar.equipped_at else now() end,
    character_id = excluded.character_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- Adds p_xp experience and one win to the equipped avatar, then recalculates the level.
-- The row is locked first, so two wins arriving together cannot overwrite each other.
-- p_cooldown_seconds blocks wins that arrive too fast after the previous one.
-- Returns {"status": "xp_gained" | "no_avatar" | "cooldown", "old_level": n, "avatar": {...}}
create or replace function public.add_avatar_xp(p_user_id bigint, p_xp integer, p_cooldown_seconds integer)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_row public.equipped_avatar;
  v_old integer;
begin
  if p_xp is null or p_xp < 1 then
    raise exception 'p_xp must be at least 1';
  end if;

  select level into v_old from public.equipped_avatar where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('status', 'no_avatar');
  end if;

  update public.equipped_avatar
     set xp = xp + p_xp,
         wins = wins + 1,
         last_win_at = now(),
         level = public.avatar_level_for_xp(xp + p_xp)
   where user_id = p_user_id
     and (last_win_at is null or last_win_at <= now() - make_interval(secs => p_cooldown_seconds))
  returning * into v_row;

  if found then
    return jsonb_build_object('status', 'xp_gained', 'old_level', v_old, 'avatar', to_jsonb(v_row));
  end if;

  select * into v_row from public.equipped_avatar where user_id = p_user_id;
  return jsonb_build_object('status', 'cooldown', 'old_level', v_old, 'avatar', to_jsonb(v_row));
end;
$$;

-- Recalculate existing avatars (only those that still have no XP, so a re-run never undoes real progress)
update public.equipped_avatar
   set xp = wins * 50
 where xp = 0 and wins > 0;
update public.equipped_avatar
   set level = public.avatar_level_for_xp(xp);

drop function if exists public.level_up_avatar(bigint, integer);

-- 2) Only the API (secret key = service_role) may call the functions or touch the tables.
--    Written as a block so it also runs on a plain Postgres that has no Supabase roles.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated')
     and exists (select 1 from pg_roles where rolname = 'service_role') then

    revoke all on public.roles, public.users, public.equipped_avatar, public.audit_log
      from anon, authenticated;

    revoke all on function public.record_failed_login(bigint, integer, integer),
                           public.record_successful_login(bigint),
                           public.change_password(bigint, text),
                           public.revoke_tokens(bigint),
                           public.equip_avatar(bigint, bigint),
                           public.avatar_level_for_xp(integer),
                           public.add_avatar_xp(bigint, integer, integer)
      from public, anon, authenticated;

    grant execute on function public.record_failed_login(bigint, integer, integer),
                              public.record_successful_login(bigint),
                              public.change_password(bigint, text),
                              public.revoke_tokens(bigint),
                              public.equip_avatar(bigint, bigint),
                              public.avatar_level_for_xp(integer),
                              public.add_avatar_xp(bigint, integer, integer)
      to service_role;
  end if;
end
$$;

-- ============ checks (read-only) ============
-- 1) Should list the new function names: add_avatar_xp, avatar_level_for_xp, equip_avatar
select proname from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('add_avatar_xp','avatar_level_for_xp','equip_avatar','level_up_avatar')
order by proname;

-- 2) Should show 0 XP -> level 0, 100 -> 1, 225 -> 2, 381 -> 3
select xp, public.avatar_level_for_xp(xp) as level from (values (0),(99),(100),(224),(225),(381)) t(xp);
