"""Killer Hunt: the turn-based engine for Killer avatars in the Trial.

You are the Killer. Four AI Survivors repair five generators. Sacrifice 3 of them before the last
generator is done. Same design as Escape (api/_trial.py): pure Python, no database, the server rolls
every die, and public_view() is the only thing the browser ever sees (no seed, no hit chances, no AI skill).

The leading underscore keeps Vercel from treating this file as a separate serverless function.
"""
import random

import _trial as base      # shared helpers: power_bonus(), clamp(), AGGRESSION, perk unlock levels

# ---------------- rules ----------------
GENS_TO_FINISH = 5            # when the Survivors finish all five, the gates open and they escape
GEN_NEEDED = 100.0
SACRIFICES_TO_WIN = 3
MAX_TURNS = 30
SURVIVOR_COUNT = 4

WORK_RATE = 7.0               # generator progress per working Survivor per turn
KICK_REGRESS = 45.0           # a Kick undoes this much progress (finished generators stay finished)
JAM_REGRESS = 60.0            # the "jam" perk undoes more and stops all repairs this turn

BASE_FIND = 0.65              # chance a Patrol finds someone
BASE_HIT = 0.45               # chance a Chase hits an average Survivor (divided by their skill)
POWER_BOOST = 0.25            # extra hit chance on the turn you use your power
POWER_COOLDOWN = 3            # turns before the power is ready again
TRACKER_BOOST = 0.25          # extra hit chance for the "tracker" perk
LOSE_TARGET_CHANCE = 0.25     # after a miss, the Survivor may get away entirely

BASE_RESCUE = 0.30            # chance per turn that a free teammate unhooks someone
CAMP_RESCUE_FACTOR = 0.25     # camping the hook makes rescues this much as likely
HEAL_CHANCE = 0.12            # an injured Survivor heals themselves this often (times their skill)
HOOK_TIMER_START = 4          # a hooked Survivor dies after this many turns; each earlier hook takes one off (min 1)

# How strongly the avatar bonus (0 to 0.25) helps: more hits, easier finds, slower repairs, fewer rescues
BONUS_POWER = 0.45

PERK_UNLOCK_LEVELS = base.PERK_UNLOCK_LEVELS     # same levels as Escape: 10, 40, 75
PERK_EFFECTS = {
    "perk_1": "tracker",      # find a target for sure and strike with a bonus
    "perk_2": "jam",          # big generator regression and the Survivors cannot repair this turn
    "perk_3": "finisher",     # a hooked Survivor is sacrificed on the spot
}
BASE_ACTIONS = ("patrol", "chase", "camp", "kick")


def _catchable(s: dict) -> bool:
    return s["status"] in ("healthy", "injured")


def _rng(state: dict) -> random.Random:
    return random.Random(f"{state['seed']}:{state['turn']}")


def kills(state: dict) -> int:
    return sum(1 for s in state["survivors"] if s["status"] == "dead")


def _completed_floor(state: dict) -> float:
    return min(int(state["gen_total"] // GEN_NEEDED), GENS_TO_FINISH) * GEN_NEEDED


# ---------------- creating a run ----------------
def new_run(killer: dict, survivors: list, level: int, prestige: int, seed: str, max_level: int = 100) -> dict:
    """killer = the player's avatar row, survivors = rows of the AI Survivors (the API picks four).
    Level and Prestige are copied in now, so leveling up elsewhere cannot change a run in progress."""
    return {
        "mode": "hunt",
        "seed": seed,
        "turn": 0,
        "status": "active",               # active | won | lost
        "outcome": None,
        "level": int(level),
        "prestige": int(prestige),
        "bonus": round(base.power_bonus(level, prestige, max_level), 4),
        "killer": {"id": killer["id"], "name": killer["name"], "image": killer.get("image"),
                   "power": killer.get("power") or "Your power",
                   "perks": [killer["perk_1"], killer["perk_2"], killer["perk_3"]]},
        "survivors": [{
            "id": s["id"], "name": s["name"], "image": s.get("image"),
            "skill": base.AGGRESSION.get(s.get("difficulty"), 1.0),
            "status": "healthy",          # healthy | injured | hooked | dead
            "hooks": 0, "timer": 0,
        } for s in survivors[:SURVIVOR_COUNT]],
        "target": None,                   # index of the Survivor you are chasing
        "gen_total": 0.0,
        "power_cd": 0,
        "perks_used": [],
        "log": ["The fog thickens. Four Survivors scatter toward the generators."],
    }


# ---------------- what the player can do ----------------
def available_actions(state: dict) -> list:
    survivors = state["survivors"]
    any_catchable = any(_catchable(s) for s in survivors)
    hooked = [s for s in survivors if s["status"] == "hooked"]
    kickable = state["gen_total"] - _completed_floor(state) > 0.5

    def row(id_, label, enabled, reason=None, kind=None):
        r = {"id": id_, "label": label, "enabled": enabled, "reason": None if enabled else reason}
        if kind:
            r["kind"] = kind
        return r

    out = [
        row("patrol", "Patrol", any_catchable, "No one is left to find."),
        row("chase", "Chase", state["target"] is not None, "Find someone to chase first (Patrol)."),
        row("camp", "Camp", bool(hooked), "No one is hooked."),
        row("kick", "Kick Generator", kickable, "No generator progress to undo."),
    ]
    cd = state["power_cd"]
    out.append(row("power", state["killer"]["power"], cd == 0 and any_catchable,
                   f"Recharging ({cd} turn{'s' if cd != 1 else ''})." if cd else "No one to hunt.", "power"))
    for index, slot in enumerate(("perk_1", "perk_2", "perk_3")):
        need = PERK_UNLOCK_LEVELS[slot]
        name = state["killer"]["perks"][index]
        kind = PERK_EFFECTS[slot]
        if state["level"] < need:
            out.append(row(slot, name, False, f"Unlocks at level {need}.", kind))
        elif slot in state["perks_used"]:
            out.append(row(slot, name, False, "Already used this run.", kind))
        elif kind == "tracker" and not any_catchable:
            out.append(row(slot, name, False, "No one to hunt.", kind))
        elif kind == "finisher" and not hooked:
            out.append(row(slot, name, False, "No one is hooked.", kind))
        else:
            out.append(row(slot, name, True, None, kind))
    return out


def public_view(state: dict) -> dict:
    """Everything the browser may see. No seed, no hit chances, no Survivor skill."""
    current = state["gen_total"] % GEN_NEEDED if state["gen_total"] < GEN_NEEDED * GENS_TO_FINISH else 0.0
    return {
        "mode": "hunt",
        "turn": state["turn"], "max_turns": MAX_TURNS, "status": state["status"], "outcome": state["outcome"],
        "level": state["level"], "prestige": state["prestige"], "bonus_percent": round(state["bonus"] * 100, 1),
        "killer": {"id": state["killer"]["id"], "name": state["killer"]["name"],
                   "image": state["killer"]["image"], "power": state["killer"]["power"]},
        "survivors": [{
            "id": s["id"], "name": s["name"], "image": s["image"], "status": s["status"],
            "timer": s["timer"] if s["status"] == "hooked" else None,
            "targeted": i == state["target"],
        } for i, s in enumerate(state["survivors"])],
        "generators": {"done": min(int(state["gen_total"] // GEN_NEEDED), GENS_TO_FINISH), "needed": GENS_TO_FINISH,
                       "progress_percent": int(current)},
        "sacrifices": {"done": kills(state), "needed": SACRIFICES_TO_WIN},
        "power": {"name": state["killer"]["power"], "cooldown": state["power_cd"]},
        "actions": available_actions(state) if state["status"] == "active" else [],
        "log": state["log"][-8:],
    }


# ---------------- one turn ----------------
def _pick_target(state: dict, rng: random.Random) -> int:
    options = [i for i, s in enumerate(state["survivors"]) if _catchable(s)]
    return rng.choice(options)


def _strike(state: dict, rng: random.Random, extra: float = 0.0) -> None:
    """One attack on the current target."""
    log = state["log"]
    idx = state["target"]
    s = state["survivors"][idx]
    chance = base.clamp(BASE_HIT / s["skill"] + BONUS_POWER * state["bonus"] + extra, 0.10, 0.95)
    if rng.random() < chance:
        if s["status"] == "healthy":
            s["status"] = "injured"
            log.append(f"You hit {s['name']}! They are injured but still running.")
        else:
            s["status"] = "hooked"
            s["hooks"] += 1
            s["timer"] = max(1, HOOK_TIMER_START - s["hooks"])
            state["target"] = None
            log.append(f"You catch {s['name']} and put them on a hook!")
    else:
        log.append(f"{s['name']} slips out of your reach.")
        if rng.random() < LOSE_TARGET_CHANCE:
            state["target"] = None
            log.append("You lose their trail.")


def _sacrifice(state: dict, s: dict) -> None:
    s["status"], s["timer"] = "dead", 0
    state["log"].append(f"{s['name']} is sacrificed to the Entity!")


def step(state: dict, action: str) -> dict:
    """Plays one player action and the Survivors' answer. Changes and returns the state.
    Raises ValueError for an action that is not allowed (the turn is NOT used up then)."""
    if state["status"] != "active":
        raise ValueError("This hunt is already over.")
    legal = {a["id"]: a for a in available_actions(state)}
    if action not in legal:
        raise ValueError("Unknown action.")
    if not legal[action]["enabled"]:
        raise ValueError(legal[action]["reason"] or "That action is not available.")

    rng = _rng(state)
    b = state["bonus"]
    log = state["log"]
    survivors = state["survivors"]
    camping = False
    jam = False

    if state["power_cd"] > 0:
        state["power_cd"] -= 1

    # ----- 1. the Killer acts -----
    if action == "patrol":
        state["target"] = None
        if rng.random() < base.clamp(BASE_FIND + BONUS_POWER * b, 0.05, 0.95):
            state["target"] = _pick_target(state, rng)
            log.append(f"You spot {survivors[state['target']]['name']} and give chase.")
        else:
            log.append("You sweep the area but find no one.")
    elif action == "chase":
        _strike(state, rng)
    elif action == "camp":
        camping = True
        log.append("You wait beside the hook, watching for rescuers.")
    elif action == "kick":
        floor = _completed_floor(state)
        state["gen_total"] = max(floor, state["gen_total"] - KICK_REGRESS)
        log.append("You smash a generator. Progress is lost!")
    elif action == "power":
        state["power_cd"] = POWER_COOLDOWN
        if state["target"] is None:
            state["target"] = _pick_target(state, rng)
        log.append(f"{state['killer']['power']}! You strike at {survivors[state['target']]['name']}.")
        _strike(state, rng, POWER_BOOST)
    else:
        state["perks_used"].append(action)
        effect = PERK_EFFECTS[action]
        name = state["killer"]["perks"][int(action[-1]) - 1]
        if effect == "tracker":
            state["target"] = _pick_target(state, rng)
            log.append(f"{name}: you know exactly where {survivors[state['target']]['name']} is.")
            _strike(state, rng, TRACKER_BOOST)
        elif effect == "jam":
            state["gen_total"] = max(_completed_floor(state), state["gen_total"] - JAM_REGRESS)
            jam = True
            log.append(f"{name}: every generator shudders and goes dark.")
        elif effect == "finisher":
            doomed = min((s for s in survivors if s["status"] == "hooked"), key=lambda s: s["timer"])
            log.append(f"{name}: the Entity takes its due early.")
            _sacrifice(state, doomed)

    # ----- 2. the Survivors answer -----
    target = state["target"]
    workers = [s for i, s in enumerate(survivors) if _catchable(s) and i != target]

    if not jam:
        before = int(state["gen_total"] // GEN_NEEDED)
        rate = sum(WORK_RATE * s["skill"] * (0.8 if s["status"] == "injured" else 1.0) for s in workers)
        state["gen_total"] = min(state["gen_total"] + rate * (1.0 - BONUS_POWER * b), GEN_NEEDED * GENS_TO_FINISH)
        for n in range(before + 1, min(int(state["gen_total"] // GEN_NEEDED), GENS_TO_FINISH) + 1):
            log.append(f"Generator {n} of {GENS_TO_FINISH} is repaired.")

    rescued = None
    hooked = [s for s in survivors if s["status"] == "hooked"]
    if hooked and workers:
        skill = sum(s["skill"] for s in workers) / len(workers)
        chance = base.clamp(BASE_RESCUE * skill * (CAMP_RESCUE_FACTOR if camping else 1.0) * (1.0 - BONUS_POWER * b), 0.0, 0.9)
        if rng.random() < chance:
            rescued = min(hooked, key=lambda s: s["timer"])
            rescued["status"], rescued["timer"] = "injured", 0
            log.append(f"A teammate unhooks {rescued['name']}!")

    for i, s in enumerate(survivors):
        if s["status"] == "injured" and i != target and s is not rescued and rng.random() < HEAL_CHANCE * s["skill"]:
            s["status"] = "healthy"
            log.append(f"{s['name']} patches themselves up.")

    for s in survivors:
        if s["status"] == "hooked" and s is not rescued:
            s["timer"] -= 1
            if s["timer"] <= 0:
                _sacrifice(state, s)

    # ----- 3. end of turn -----
    state["turn"] += 1
    if kills(state) >= SACRIFICES_TO_WIN:
        state["status"], state["outcome"] = "won", "sacrificed"
        log.append("The Entity is pleased. The hunt is yours!")
    elif state["gen_total"] >= GEN_NEEDED * GENS_TO_FINISH:
        state["status"], state["outcome"] = "lost", "gates_open"
        log.append("The last generator roars to life. The Survivors flee through the gates!")
    elif state["turn"] >= MAX_TURNS:
        state["status"], state["outcome"] = "lost", "out_of_time"
        log.append("You took too long. The Survivors slip away into the fog.")
    return state
