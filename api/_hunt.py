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
TRACKER_BOOST = 0.25          # extra hit chance for the "tracker" perk
LOSE_TARGET_CHANCE = 0.25     # after a miss, the Survivor may get away entirely

BASE_RESCUE = 0.30            # chance per turn that a free teammate unhooks someone
CAMP_RESCUE_FACTOR = 0.25     # camping the hook makes rescues this much as likely
HEAL_CHANCE = 0.12            # an injured Survivor heals themselves this often (times their skill)
HOOK_TIMER_START = 4          # a hooked Survivor dies after this many turns; each earlier hook takes one off (min 1)

# How strongly the avatar bonus (0 to 0.25) helps: more hits, easier finds, slower repairs, fewer rescues
BONUS_POWER = 0.45

PERK_UNLOCK_LEVELS = base.PERK_UNLOCK_LEVELS     # same levels as Escape: 10, 40, 75
BASE_ACTIONS = ("patrol", "chase", "camp", "kick")

# ---------------- Killer perks ----------------
# Every perk is a one-use move (unlocked at level 10 / 40 / 75 by slot), simplified into 6 easy kinds.
HASTE_BOOST = 0.45            # extra hit chance on the attack after a "haste" perk
LOCK_TURNS = 3                # "lockdown": no rescues and no self-healing for this many turns
PERK_KINDS = {
    "tracker":  "Find a target for sure and strike with a bonus.",
    "haste":    "Find a target for sure. Your next attack is much stronger.",
    "jam":      "Undo a lot of generator progress and stop all repairs this turn.",
    "slow":     "Curse the generators: repairs are heavily slowed for 4 turns and your next attack is stronger.",
    "lockdown": "For 3 turns nobody can be rescued and nobody can heal.",
    "finisher": "A hooked Survivor is sacrificed on the spot.",
}
_KIND_PERKS = {
    "tracker": ["Predator", "Bloodhound", "Beast of Prey", "Alien Instinct", "Wandering Eye", "I'm All Ears", "Nowhere to Hide",
                "Awakened Awareness", "Surveillance", "Zanshin Tactics", "Darkness Revealed", "Lethal Pursuer",
                "Territorial Imperative", "A Nurse's Calling", "Furtive Chase", "Mindbreaker", "Gearhead", "Blood Echo",
                "Unforeseen", "Dark Arrogance", "Machine Learning", "Hoarder", "Unnerving Presence", "Silent Shadow", "Nemesis"],
    "haste": ["Brutal Strength", "Agitation", "Enduring", "Tinkerer", "Save the Best for Last", "Play with Your Food",
              "Fire Up", "Spirit Fury", "Rapid Brutality", "Rampage", "Starstruck", "Lightborn", "Knock Out", "Hysteria",
              "Superior Anatomy", "Stridor", "Shadowborn", "Surge", "Dragon's Grip", "Unbound", "Ravenous", "Thwack!",
              "Dissolution", "Help Wanted"],
    "jam": ["Hex: Ruin", "Overcharge", "Pop Goes the Weasel", "Thrilling Tremors", "Eruption", "Corrupt Intervention",
            "Deadlock", "Genetic Limits", "Haywire", "Overwhelming Presence", "Monitor & Abuse", "Languid Bleed",
            "Forced Hesitation", "Septic Touch", "Coulrophobia", "Thanatophobia", "Discordance", "Oppression",
            "Merciless Storm", "Call of Brine", "Undone", "Weave Attunement", "Leverage", "Game Afoot", "Hex: Overture of Doom",
            "Phantom Fear", "Hex: Pentimento", "All-shaking Thunder"],
    "slow": ["Hex: The Third Seal", "The Third Seal", "Hex: Haunted Ground", "Hex: Blood Favor", "Hex: Undying",
             "Hex: Crowd Control", "Hex: Plaything", "Hex: Face the Darkness", "Hex: Two Can Play", "Hex: Wretched Fate",
             "Hex: Nothing But Misery", "Hex: Hive Mind", "Hex: Scared to Death", "Hex: Under Your Thumb", "Hex: Retribution",
             "Hex: Huntress Lullaby", "Infectious Fright", "Madness", "Cruel Limits", "Secret Project", "Turn Back The Clock",
             "Friends 'Til the End", "Batteries Included", "Scourge Hook: Pain Resonance"],
    "lockdown": ["Make Your Choice", "Barbecue & Chili", "Iron Maiden", "Trail of Torment", "Deathbound", "Remember Me",
                 "Blood Warden", "Dead Man's Switch", "No Quarter", "Hangman's Trick", "Dominance", "Human Greed", "Hubris",
                 "Forced Penance", "Celestial Witness", "No Way Out", "Dying Light", "Terminus", "None Are Free",
                 "Forever Entwined", "Dark Devotion", "Rancor"],
    "finisher": ["Hex: Devour Hope", "Coupe de Grâce", "Scourge Hook: Gift of Pain", "Scourge Hook: Floods of Rage",
                 "Scourged Hook: Jagged Compass", "Grim Embrace", "Lay Waste", "Ultimate Weapon", "Franklin's Demise",
                 "Hex: Devour Hope"],
}
PERK_KIND_BY_NAME = {name: kind for kind, names in _KIND_PERKS.items() for name in names}
_SLOT_DEFAULT = ("tracker", "jam", "finisher")      # perk names we do not know: the old fixed behaviour by slot


def perk_kind(perk_name, slot_index: int) -> str:
    return PERK_KIND_BY_NAME.get(perk_name or "") or _SLOT_DEFAULT[slot_index]

# ---------------- Killer powers ----------------
# Every Killer power is a simplified version of its real idea, grouped into 7 easy mechanics.
# cd = turns before it is ready again. The real powers are far more complex; this keeps the game readable.
PRIME_BOOST = 0.30            # extra hit chance on the next attack after "stalk"
SLOW_FACTOR = 0.35            # repair speed multiplier while "slow" is active
POWER_KINDS = {
    "strike": {"cd": 3, "boost": 0.25, "help": "A strong attack on your target (or a random Survivor)."},
    "ranged": {"cd": 2, "boost": 0.15, "help": "Attack from a distance. Recharges fast and never loses your trail."},
    "dash":   {"cd": 5, "boost": 0.10, "help": "Close the gap: you find someone for sure and hit hard."},
    "stalk":  {"cd": 3, "boost": 0.00, "help": "Vanish and find a target for sure. Your next attack is stronger."},
    "trap":   {"cd": 4, "boost": 0.00, "help": "Set traps. You find a target for sure, your next attack is stronger and repairs are heavily slowed for 4 turns."},
    "frenzy": {"cd": 4, "boost": 0.10, "help": "Attack your target and a second Survivor at once."},
    "regress": {"cd": 4, "boost": 0.00, "help": "Corrupt the generators: you find a target for sure, your next attack is stronger, progress is lost and repairs are slowed for 3 turns."},
    "doom":   {"cd": 4, "boost": 0.00, "help": "Hooked Survivors lose a turn on their timer and cannot be rescued this turn."},
}
_KIND_POWERS = {
    "trap": ["Bear Trap", "Phantasm Traps", "Eyes in the Sky", "Quantum Instantiation", "Guardia Compagnia", "Fazbear's Fright"],
    "stalk": ["Wailing Bell", "Evil Within", "Night Shroud", "Reign of Darkness", "Hidden Pursuit", "Playtime's Over",
              "Scent of Blood", "Yamaoka's Haunting", "Omnipresent Evil"],
    "dash": ["Chainsaw Sprint", "Spencer's Last Breath", "Bubba's Chainsaw", "Blighted Rush", "Yamaoka's Wrath", "Of the Abyss",
             "Visceral Flight", "Virulent Bound", "One-Eyed Terror", "Transformation"],
    "ranged": ["Hunting Hatchets", "The Redeemer", "Birds of Torment", "Showstopper", "T-Virus", "Summons of Pain",
               "The Afterpiece Tonic"],
    "frenzy": ["Feral Frenzy", "Blood Bond", "Carter's Spark"],
    "regress": ["Vile Purge", "Deluge of Fear", "Vile Book of Spells", "UVX", "Test Subject #001"],
    "doom": ["Rites of Judgement", "Divine Condemned", "Jigsaw's Baptism"],
    "strike": ["Dream Demon"],
}
POWER_KIND_BY_NAME = {name: kind for kind, names in _KIND_POWERS.items() for name in names}


def power_kind(power_name) -> str:
    """Unknown or new powers (a Killer an admin adds later) fall back to a plain strike."""
    return POWER_KIND_BY_NAME.get(power_name or "", "strike")


def _kind(state: dict) -> str:
    return state["killer"].get("power_kind") or "strike"      # runs saved before powers existed


def _perk_kind_at(state: dict, index: int) -> str:
    kinds = state["killer"].get("perk_kinds")             # runs saved before per-perk effects use the old slot effects
    return kinds[index] if kinds else _SLOT_DEFAULT[index]


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
                   "power_kind": power_kind(killer.get("power")),
                   "perks": [killer["perk_1"], killer["perk_2"], killer["perk_3"]],
                   "perk_kinds": [perk_kind(killer[f"perk_{i + 1}"], i) for i in range(3)]},
        "survivors": [{
            "id": s["id"], "name": s["name"], "image": s.get("image"),
            "skill": base.AGGRESSION.get(s.get("difficulty"), 1.0),
            "status": "healthy",          # healthy | injured | hooked | dead
            "hooks": 0, "timer": 0,
        } for s in survivors[:SURVIVOR_COUNT]],
        "target": None,                   # index of the Survivor you are chasing
        "gen_total": 0.0,
        "power_cd": 0,
        "primed": False,                  # "stalk": the next attack is stronger
        "slow": 0,                        # turns of slowed repairs left ("trap", "regress")
        "haste": False,                   # a "haste" perk: the next attack is much stronger
        "lock": 0,                        # "lockdown" perk: turns left with no rescues and no healing
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
    pk = _kind(state)
    if pk == "doom":
        ready, why = bool(hooked), "No one is hooked."
    elif pk in ("strike", "ranged", "frenzy"):
        ready, why = state["target"] is not None, "Find someone to chase first (Patrol)."
    else:
        ready, why = any_catchable, "No one to hunt."
    out.append(row("power", state["killer"]["power"], cd == 0 and ready,
                   f"Recharging ({cd} turn{'s' if cd != 1 else ''})." if cd else why, "power"))
    out[-1]["help"] = POWER_KINDS[pk]["help"]
    for index, slot in enumerate(("perk_1", "perk_2", "perk_3")):
        need = PERK_UNLOCK_LEVELS[slot]
        name = state["killer"]["perks"][index]
        kind = _perk_kind_at(state, index)
        if state["level"] < need:
            out.append(row(slot, name, False, f"Unlocks at level {need}.", kind))
        elif slot in state["perks_used"]:
            out.append(row(slot, name, False, "Already used this run.", kind))
        elif kind in ("tracker", "haste") and not any_catchable:
            out.append(row(slot, name, False, "No one to hunt.", kind))
        elif kind == "finisher" and not hooked:
            out.append(row(slot, name, False, "No one is hooked.", kind))
        else:
            out.append(row(slot, name, True, None, kind))
        out[-1]["help"] = PERK_KINDS[kind]
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
        "power": {"name": state["killer"]["power"], "cooldown": state["power_cd"],
                  "kind": _kind(state), "help": POWER_KINDS[_kind(state)]["help"]},
        "actions": available_actions(state) if state["status"] == "active" else [],
        "log": state["log"][-8:],
    }


# ---------------- one turn ----------------
def _pick_target(state: dict, rng: random.Random) -> int:
    options = [i for i, s in enumerate(state["survivors"]) if _catchable(s)]
    return rng.choice(options)


def _strike(state: dict, rng: random.Random, extra: float = 0.0, idx=None, keep_trail: bool = False) -> None:
    """One attack. On the current target by default, or on Survivor number idx."""
    log = state["log"]
    idx = state["target"] if idx is None else idx
    s = state["survivors"][idx]
    if state.get("primed"):
        extra += PRIME_BOOST
        state["primed"] = False
    if state.get("haste"):
        extra += HASTE_BOOST
        state["haste"] = False
    chance = base.clamp(BASE_HIT / s["skill"] + BONUS_POWER * state["bonus"] + extra, 0.10, 0.95)
    if rng.random() < chance:
        if s["status"] == "healthy":
            s["status"] = "injured"
            log.append(f"You hit {s['name']}! They are injured but still running.")
        else:
            s["status"] = "hooked"
            s["hooks"] += 1
            s["timer"] = max(1, HOOK_TIMER_START - s["hooks"])
            if state["target"] == idx:
                state["target"] = None
            log.append(f"You catch {s['name']} and put them on a hook!")
    else:
        log.append(f"{s['name']} slips out of your reach.")
        if not keep_trail and state["target"] == idx and rng.random() < LOSE_TARGET_CHANCE:
            state["target"] = None
            log.append("You lose their trail.")


def _find(state: dict, rng: random.Random) -> None:
    """Powers that scout as a side effect: you start chasing someone if you were not already."""
    if state["target"] is None:
        state["target"] = _pick_target(state, rng)


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
    no_rescue = False

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
        kind = _kind(state)
        spec = POWER_KINDS[kind]
        state["power_cd"] = spec["cd"]
        pname = state["killer"]["power"]
        if kind in ("strike", "ranged", "dash", "frenzy"):
            if state["target"] is None:
                state["target"] = _pick_target(state, rng)
            log.append(f"{pname}! You go for {survivors[state['target']]['name']}.")
            first = state["target"]
            _strike(state, rng, spec["boost"], keep_trail=(kind == "ranged"))
            if kind == "frenzy":
                others = [i for i, o in enumerate(survivors) if _catchable(o) and i != first]
                if others:
                    _strike(state, rng, spec["boost"], idx=rng.choice(others), keep_trail=True)
        elif kind == "stalk":
            state["target"] = _pick_target(state, rng)
            state["primed"] = True
            log.append(f"{pname}: you slip out of sight and find {survivors[state['target']]['name']}. Your next attack is stronger.")
        elif kind == "trap":
            state["slow"] = 4
            state["primed"] = True
            _find(state, rng)
            log.append(f"{pname}: traps are set across the map. Repairs will be slower.")
        elif kind == "regress":
            state["gen_total"] = max(_completed_floor(state), state["gen_total"] - 40.0)
            state["slow"] = 3
            state["primed"] = True
            _find(state, rng)
            log.append(f"{pname}: the generators sputter and lose power.")
        elif kind == "doom":
            no_rescue = True
            log.append(f"{pname}: the hooks tighten. Hooked Survivors are running out of time.")
            for o in survivors:
                if o["status"] == "hooked":
                    o["timer"] -= 1
                    if o["timer"] <= 0:
                        _sacrifice(state, o)
    else:
        state["perks_used"].append(action)
        index = int(action[-1]) - 1
        effect = _perk_kind_at(state, index)
        name = state["killer"]["perks"][index]
        if effect == "tracker":
            state["target"] = _pick_target(state, rng)
            log.append(f"{name}: you know exactly where {survivors[state['target']]['name']} is.")
            _strike(state, rng, TRACKER_BOOST)
        elif effect == "haste":
            _find(state, rng)
            state["haste"] = True
            log.append(f"{name}: you pick up the pace. Your next attack will hit hard.")
        elif effect == "jam":
            state["gen_total"] = max(_completed_floor(state), state["gen_total"] - JAM_REGRESS)
            jam = True
            log.append(f"{name}: every generator shudders and goes dark.")
        elif effect == "slow":
            state["slow"] = max(state.get("slow", 0), 4)
            state["primed"] = True
            _find(state, rng)
            log.append(f"{name}: a dark curse settles over the generators. Repairs slow to a crawl.")
        elif effect == "lockdown":
            state["lock"] = LOCK_TURNS
            log.append(f"{name}: the trial tightens. No one can be saved or healed for a while.")
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
        if state.get("slow", 0) > 0:
            rate *= SLOW_FACTOR
        state["gen_total"] = min(state["gen_total"] + rate * (1.0 - BONUS_POWER * b), GEN_NEEDED * GENS_TO_FINISH)
        for n in range(before + 1, min(int(state["gen_total"] // GEN_NEEDED), GENS_TO_FINISH) + 1):
            log.append(f"Generator {n} of {GENS_TO_FINISH} is repaired.")

    if state.get("slow", 0) > 0:
        state["slow"] -= 1

    rescued = None
    hooked = [s for s in survivors if s["status"] == "hooked"]
    locked = state.get("lock", 0) > 0
    if hooked and workers and not no_rescue and not locked:
        skill = sum(s["skill"] for s in workers) / len(workers)
        chance = base.clamp(BASE_RESCUE * skill * (CAMP_RESCUE_FACTOR if camping else 1.0) * (1.0 - BONUS_POWER * b), 0.0, 0.9)
        if rng.random() < chance:
            rescued = min(hooked, key=lambda s: s["timer"])
            rescued["status"], rescued["timer"] = "injured", 0
            log.append(f"A teammate unhooks {rescued['name']}!")

    for i, s in enumerate(survivors):
        if (s["status"] == "injured" and i != target and s is not rescued and not locked
                and rng.random() < HEAL_CHANCE * s["skill"]):
            s["status"] = "healthy"
            log.append(f"{s['name']} patches themselves up.")

    if locked:
        state["lock"] -= 1

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
