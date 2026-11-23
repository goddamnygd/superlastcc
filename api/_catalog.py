"""Perks and powers from the database.

The tables perk_kinds, perks, power_kinds and powers (sql/perks_powers.sql) say which simple move each
perk turns into and how each Killer power behaves (cooldown, attack boost, help text). This module
reads them and puts them into the two game engines (_trial.py = Escape, _hunt.py = Hunt).

The lists written in those files are only the fallback: if the tables are empty or the database
cannot be reached, the games keep using them. The database can change WHICH supported move a perk or
power uses and the numbers behind it; a brand-new kind of move still needs code in the engine, so
kinds the engine does not know are ignored instead of crashing a game.
"""
import logging
import threading
import time

import _hunt
import _trial

logger = logging.getLogger("dbd-api")

TTL_SECONDS = 60                      # how long one server instance keeps the tables before reading them again

# Moves the engines can really play (captured before the database replaces anything)
_SUPPORTED_PERK_KINDS = {"survivor": frozenset(_trial.PERK_KINDS), "killer": frozenset(_hunt.PERK_KINDS)}
_SUPPORTED_POWER_KINDS = frozenset(_hunt.POWER_KINDS)

_lock = threading.Lock()
_loaded_at = 0.0


def _replace(target: dict, new: dict) -> None:
    """Swap the contents of a dict that other modules already hold, without a moment where it is empty."""
    target.update(new)
    for key in [k for k in target if k not in new]:
        del target[key]


def _rows(client, table: str, columns: str) -> list:
    return client.table(table).select(columns).limit(5000).execute().data or []


def refresh(client, force: bool = False) -> bool:
    """Reload the tables if the cached copy is older than TTL_SECONDS. Never raises: a failure keeps what we have."""
    global _loaded_at
    if not force and time.monotonic() - _loaded_at < TTL_SECONDS:
        return True
    with _lock:
        if not force and time.monotonic() - _loaded_at < TTL_SECONDS:
            return True
        try:
            perk_kinds = _rows(client, "perk_kinds", "side, kind, help, default_slot")
            perks = _rows(client, "perks", "name, side, kind")
            power_kinds = _rows(client, "power_kinds", "kind, cooldown, boost, help, is_default")
            powers = _rows(client, "powers", "name, kind")
        except Exception:
            logger.exception("Could not read perks and powers from the database; using the built-in lists.")
            _loaded_at = time.monotonic() - TTL_SECONDS + 10      # try again in 10 seconds, not on every request
            return False
        _apply(perk_kinds, perks, power_kinds, powers)
        _loaded_at = time.monotonic()
        return True


def invalidate() -> None:
    """Called after an admin changes a row, so this instance reloads on the next request."""
    global _loaded_at
    _loaded_at = 0.0


def _apply(perk_kinds, perks, power_kinds, powers) -> None:
    engines = {"survivor": _trial, "killer": _hunt}

    # ----- perks -----
    for side, engine in engines.items():
        kinds = {r["kind"]: r["help"] for r in perk_kinds
                 if r["side"] == side and r["kind"] in _SUPPORTED_PERK_KINDS[side]}
        if not kinds:
            continue                                            # table empty: keep the built-in lists
        by_name = {r["name"]: r["kind"] for r in perks if r["side"] == side and r["kind"] in kinds}
        slots = {r["default_slot"]: r["kind"] for r in perk_kinds
                 if r["side"] == side and r["kind"] in kinds and r["default_slot"]}
        # Keep a built-in kind for any slot the database does not define, so the fallback never breaks
        slot_default = tuple(slots.get(i + 1, engine._SLOT_DEFAULT[i]) for i in range(3))
        _replace(engine.PERK_KINDS, {**engine.PERK_KINDS, **kinds})
        if by_name:
            _replace(engine.PERK_KIND_BY_NAME, by_name)
        engine._SLOT_DEFAULT = slot_default

    # ----- powers -----
    kinds = {}
    for r in power_kinds:
        if r["kind"] in _SUPPORTED_POWER_KINDS:
            kinds[r["kind"]] = {"cd": int(r["cooldown"]), "boost": float(r["boost"]), "help": r["help"]}
    if kinds:
        _replace(_hunt.POWER_KINDS, {**_hunt.POWER_KINDS, **kinds})
        by_name = {r["name"]: r["kind"] for r in powers if r["kind"] in kinds}
        if by_name:
            _replace(_hunt.POWER_KIND_BY_NAME, by_name)
        default = next((r["kind"] for r in power_kinds if r.get("is_default") and r["kind"] in kinds), None)
        if default:
            _hunt.DEFAULT_POWER_KIND = default
