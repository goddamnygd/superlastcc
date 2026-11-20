"""Survivor Escape: the turn-based engine for the Trial game.

Pure Python: no database, no web framework. The API stores the state dict as JSON, calls step() once
per player action and sends public_view() to the browser. The browser never sees the dice, the
Killer's next intention, or the seed, and every number that matters is decided here.

Randomness: every turn uses its own generator seeded from (seed, turn). The seed stays on the server,
and a turn can only be played once (the API checks the turn number), so a player cannot re-roll a turn.

The leading underscore keeps Vercel from treating this file as a separate serverless function.
"""
import math
import random
from typing import Optional

# ---------------- rules ----------------
GENS_TO_ESCAPE = 3            # generators this Survivor must finish (the team handles the rest)
GEN_NEEDED = 100.0            # progress points per generator
BASE_REPAIR = 24.0            # progress for one Repair action at +0% bonus
MAX_HP = 3                    # hits you can take: at 0 you are caught
MAX_PROXIMITY = 5             # 0 = far away ... 5 = the Killer is on you
START_PROXIMITY = 1
MAX_TURNS = 40                # the Entity gets bored: too slow = lost

# Perk "moves": the Survivor's three perks unlock as the avatar levels. Each can be used once per run.
PERK_UNLOCK_LEVELS = {"perk_1": 10, "perk_2": 40, "perk_3": 75}
PERK_EFFECTS = {
    "perk_1": "tempo",        # slip away: Killer loses 3 proximity and cannot hit you this turn
    "perk_2": "defense",      # the next hit is absorbed
    "perk_3": "push",         # a big burst of repair progress
}
PERK_PUSH_PROGRESS = 60.0

# Killer strength comes from the character's own "difficulty" field
AGGRESSION = {"Easy": 0.85, "Intermediate": 1.0, "Hard": 1.15, "Very Hard": 1.3}

# Level and Prestige give a capped bonus (max +25%): up to +15% from level, up to +10% from Prestige
MAX_LEVEL_BONUS = 0.15
MAX_PRESTIGE_BONUS = 0.10
PRESTIGE_CURVE = 25.0         # diminishing returns: Prestige 25 gives ~63% of the Prestige bonus

BASE_SPEED = 4.0              # a Killer at this movement speed is "normal"
BASE_TERROR = 32.0            # a Killer at this terror radius is "normal"

AWARE_BASE = 0.50             # chance per turn the Killer homes in on you (before noise, aggression, bonus)
LOUD_REPAIR = 0.25            # repairing is noisy
STEALTH_FROM_BONUS = 0.6      # a +25% avatar makes the Killer 15% less likely to find you

BASE_ACTIONS = ("repair", "hide", "run", "heal")


def _num(value, default: float) -> float:
    """Reads '4.0', '32 meters' or 4 as a number; falls back to the default."""
    try:
        text = "".join(ch for ch in str(value) if ch.isdigit() or ch == ".")
        number = float(text)
        return number if number > 0 else default
    except (TypeError, ValueError):
        return default


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def power_bonus(level: int, prestige: int, max_level: int = 100) -> float:
    """Total bonus for an avatar, 0.0 to 0.25. Capped so a maxed avatar is strong, not unbeatable."""
    level = int(clamp(level, 1, max_level))
    prestige = max(int(prestige), 0)
    from_level = MAX_LEVEL_BONUS * (level - 1) / max(max_level - 1, 1)
    from_prestige = MAX_PRESTIGE_BONUS * (1.0 - math.exp(-prestige / PRESTIGE_CURVE))
    return from_level + from_prestige


# ---------------- creating a run ----------------
def new_run(killer: dict, survivor: dict, level: int, prestige: int, seed: str, max_level: int = 100) -> dict:
    """The starting state. killer / survivor are rows from the characters table.
    Level and Prestige are copied in now, so leveling up in another tab cannot change a run in progress."""
    state = {
        "seed": seed,
        "turn": 0,
        "status": "active",            # active | won | lost
        "outcome": None,
        "level": int(level),
        "prestige": int(prestige),
        "bonus": round(power_bonus(level, prestige, max_level), 4),
        "gens_done": 0,
        "gen_progress": 0.0,
        "hp": MAX_HP,
        "proximity": START_PROXIMITY,
        "hidden": False,
        "shield": False,
        "perks_used": [],
        "survivor": {"id": survivor["id"], "name": survivor["name"],
                     "perks": [survivor["perk_1"], survivor["perk_2"], survivor["perk_3"]]},
        "killer": {
            "id": killer["id"], "name": killer["name"], "image": killer.get("image"),
            "power": killer.get("power"), "difficulty": killer.get("difficulty", "Intermediate"),
            "aggression": AGGRESSION.get(killer.get("difficulty"), 1.0),
            "speed": _num(killer.get("movement_speed"), BASE_SPEED),
            "terror": _num(killer.get("terror_radius"), BASE_TERROR),
        },
        "log": ["The fog rolls in. A generator hums nearby."],
    }
    return state


def _rng(state: dict) -> random.Random:
    return random.Random(f"{state['seed']}:{state['turn']}")


# ---------------- what the player can do ----------------
def available_actions(state: dict) -> list:
    out = []
    healthy = state["hp"] >= MAX_HP
    for action in BASE_ACTIONS:
        enabled = not (action == "heal" and healthy)
        out.append({"id": action, "label": action.capitalize(), "enabled": enabled,
                    "reason": "Already at full health." if not enabled else None})
    for index, slot in enumerate(("perk_1", "perk_2", "perk_3")):
        need = PERK_UNLOCK_LEVELS[slot]
        name = state["survivor"]["perks"][index]
        if state["level"] < need:
            reason = f"Unlocks at level {need}."
            enabled = False
        elif slot in state["perks_used"]:
            reason, enabled = "Already used this run.", False
        else:
            reason, enabled = None, True
        out.append({"id": slot, "label": name, "enabled": enabled, "reason": reason,
                    "kind": PERK_EFFECTS[slot]})
    return out


def heartbeat(state: dict) -> int:
    """What the player can sense: 0 silent, 1 faint, 2 pounding, 3 chase.
    A bigger terror radius makes the Killer easier to sense, a smaller one makes them stealthy."""
    scaled = state["proximity"] * (state["killer"]["terror"] / BASE_TERROR)
    if scaled < 1.5:
        return 0
    if scaled < 2.75:
        return 1
    if scaled < 4.0:
        return 2
    return 3


def public_view(state: dict) -> dict:
    """Everything the browser may see. No seed, no exact proximity, no Killer intention."""
    k = state["killer"]
    return {
        "turn": state["turn"], "max_turns": MAX_TURNS, "status": state["status"], "outcome": state["outcome"],
        "generators": {"done": state["gens_done"], "needed": GENS_TO_ESCAPE,
                       "progress_percent": int(min(state["gen_progress"], GEN_NEEDED))},
        "hp": state["hp"], "max_hp": MAX_HP, "hidden": state["hidden"], "shield": state["shield"],
        "heartbeat": heartbeat(state),
        "level": state["level"], "prestige": state["prestige"], "bonus_percent": round(state["bonus"] * 100, 1),
        "survivor": state["survivor"],
        "killer": {"id": k["id"], "name": k["name"], "image": k["image"], "power": k["power"], "difficulty": k["difficulty"]},
        "actions": available_actions(state) if state["status"] == "active" else [],
        "log": state["log"][-8:],
    }


# ---------------- one turn ----------------
def step(state: dict, action: str) -> dict:
    """Plays one player action and the Killer's answer. Changes and returns the state.
    Raises ValueError for an action that is not allowed (the turn is NOT used up then)."""
    if state["status"] != "active":
        raise ValueError("This run is already over.")

    legal = {a["id"]: a for a in available_actions(state)}
    if action not in legal:
        raise ValueError("Unknown action.")
    if not legal[action]["enabled"]:
        raise ValueError(legal[action]["reason"] or "That action is not available.")

    rng = _rng(state)
    b = state["bonus"]
    k = state["killer"]
    speed_ratio = k["speed"] / BASE_SPEED
    log = state["log"]
    no_hit_this_turn = False
    loud = 0.0                       # how much noise the action makes (adds to the Killer finding you)

    # ----- 1. the player acts -----
    if action != "hide":
        state["hidden"] = False

    if action == "repair":
        gain = BASE_REPAIR * (1.0 + b)
        state["gen_progress"] += gain
        loud = LOUD_REPAIR
        log.append("You work on the generator.")
    elif action == "hide":
        state["hidden"] = True
        log.append("You crouch out of sight and hold your breath.")
    elif action == "run":
        if state["proximity"] >= 3:
            chance = clamp(0.58 - 0.45 * (speed_ratio - 1.0) + 0.5 * b, 0.15, 0.92)
            if rng.random() < chance:
                state["proximity"] = max(state["proximity"] - 2, 0)
                log.append("You vault a window and break line of sight.")
            else:
                state["proximity"] = min(state["proximity"] + 1, MAX_PROXIMITY)
                log.append("You stumble: the Killer closes in.")
        else:
            state["proximity"] = max(state["proximity"] - 1, 0)
            log.append("You put some distance between you and the Killer.")
    elif action == "heal":
        state["hp"] = min(state["hp"] + 1, MAX_HP)
        loud = 0.05
        log.append("You patch yourself up.")
    else:
        state["perks_used"].append(action)
        effect = PERK_EFFECTS[action]
        name = state["survivor"]["perks"][int(action[-1]) - 1]
        if effect == "tempo":
            state["proximity"] = max(state["proximity"] - 3, 0)
            no_hit_this_turn = True
            log.append(f"{name}: you slip away from the Killer.")
        elif effect == "defense":
            state["shield"] = True
            log.append(f"{name}: you brace yourself.")
        elif effect == "push":
            state["gen_progress"] += PERK_PUSH_PROGRESS * (1.0 + b)
            loud = 0.10
            log.append(f"{name}: the generator surges.")

    # a finished generator (a big push can finish more than one)
    while state["gen_progress"] >= GEN_NEEDED and state["gens_done"] < GENS_TO_ESCAPE:
        state["gen_progress"] -= GEN_NEEDED
        state["gens_done"] += 1
        log.append(f"Generator {state['gens_done']} of {GENS_TO_ESCAPE} is done!")
    if state["gens_done"] >= GENS_TO_ESCAPE:
        state["gen_progress"] = 0.0
        state["status"], state["outcome"] = "won", "escaped"
        log.append("The gates are powered. You escape the trial!")
        state["turn"] += 1
        return state

    # ----- 2. the Killer answers -----
    a = k["aggression"]
    awareness = clamp((AWARE_BASE + loud) * a * (1.0 - STEALTH_FROM_BONUS * b), 0.05, 0.95)
    if state["hidden"]:
        awareness *= 0.35
    if state["proximity"] >= 4 and not state["hidden"]:
        awareness = max(awareness, 0.85)      # already in a chase

    if rng.random() < awareness:
        state["proximity"] += 1 + (1 if rng.random() < 0.30 * a else 0)
    else:
        roll = rng.random()
        state["proximity"] += -1 if roll < 0.45 else (0 if roll < 0.85 else 1)
    state["proximity"] = int(clamp(state["proximity"], 0, MAX_PROXIMITY))

    if state["proximity"] >= MAX_PROXIMITY:
        if no_hit_this_turn:
            log.append("The Killer swings and misses!")
        elif state["shield"]:
            state["shield"] = False
            log.append("The Killer strikes, but your perk absorbs the blow!")
        else:
            state["hp"] -= 1
            log.append("The Killer hits you!")
        state["proximity"] = 3     # after a swing the Killer needs a moment to recover

    # ----- 3. end of turn -----
    state["turn"] += 1
    if state["hp"] <= 0:
        state["status"], state["outcome"] = "lost", "caught"
        log.append("You are caught. The Entity claims you.")
    elif state["turn"] >= MAX_TURNS:
        state["status"], state["outcome"] = "lost", "out_of_time"
        log.append("You took too long. The Entity claims you.")
    return state
