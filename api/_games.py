"""Pure game logic for server-checked rounds (Minigame and DBDle).

No database and no web framework in here, so it can be unit-tested on its own
(see api/tests/test_games.py). The leading underscore keeps Vercel from treating
this file as a separate serverless function.
"""
import random
from typing import Optional

MINIGAME_MODES = ("description", "perks", "image")
DBDLE_MODES = ("mixed", "survivor", "killer")
MINIGAME_LIVES = 3

DIFFICULTY_ORDER = {"Easy": 1, "Intermediate": 2, "Hard": 3, "Very Hard": 4}


def normalize(value) -> str:
    """Same rules the websites used: trim, lowercase, one kind of apostrophe, single spaces."""
    return " ".join(str(value or "").strip().lower().replace("’", "'").split())


def pick_answer(pool: list, game: str, mode: str, exclude_id: Optional[int] = None, rng=random):
    """Choose the hidden character for a new round. Returns a character dict, or None if nothing fits."""
    if game == "dbdle" and mode == "survivor":
        pool = [c for c in pool if c["role"] == "Survivor"]
    elif game == "dbdle" and mode == "killer":
        pool = [c for c in pool if c["role"] == "Killer"]
    if game == "minigame" and mode == "image":
        pool = [c for c in pool if c.get("image")]
    fresh = [c for c in pool if c["id"] != exclude_id]
    pool = fresh or pool                      # never get stuck if only one character fits
    return rng.choice(pool) if pool else None


def clue_for(mode: str, character: dict) -> dict:
    """What the Minigame shows the player. Never contains the name."""
    if mode == "description":
        return {"description": character["description"]}
    if mode == "perks":
        return {"perks": [character["perk_1"], character["perk_2"], character["perk_3"]]}
    if mode == "image":
        return {"image": character["image"]}
    return {}


def _split(value) -> list:
    out = []
    for chunk in str(value or "").lower().replace("&", ",").replace("/", ",").split(","):
        chunk = chunk.strip()
        if chunk:
            out.append(chunk)
    return out


def _text(guess, target) -> str:
    return "correct" if normalize(guess) == normalize(target) else "wrong"


def _multi(guess, target) -> str:
    if normalize(guess) == normalize(target):
        return "correct"
    targets = _split(target)
    return "partial" if any(part in targets for part in _split(guess)) else "wrong"


def _dlc(guess, target) -> str:
    g, t = normalize(guess), normalize(target)
    if g == t:
        return "correct"
    return "partial" if (g in t or t in g) else "wrong"


def _year(guess, target) -> str:
    if guess == target:
        return "correct"
    return "higher" if guess < target else "lower"     # "higher" = the answer is a later year


def _difficulty(guess, target) -> str:
    if guess == target:
        return "correct"
    g, t = DIFFICULTY_ORDER.get(guess, 0), DIFFICULTY_ORDER.get(target, 0)
    if not g or not t:
        return "wrong"
    return "higher" if g < t else "lower"


def compare(guess: dict, answer: dict) -> dict:
    """DBDle clues for one guess. This is the ONLY place the answer is compared."""
    return {
        "role": _text(guess["role"], answer["role"]),
        "gender": _text(guess["gender"], answer["gender"]),
        "origin": _multi(guess["origin"], answer["origin"]),
        "realm": _text(guess["realm"], answer["realm"]),
        "dlc": _dlc(guess["dlc"], answer["dlc"]),
        "year": _year(guess["year"], answer["year"]),
        "difficulty": _difficulty(guess["difficulty"], answer["difficulty"]),
    }
