"""Balance check for the Hunt engine: bots of different skill play thousands of runs as the Killer.
Run:  python3 tools/simulate_hunt.py          (no database needed)
Use it after changing any number in api/_hunt.py."""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import _hunt as h  # noqa: E402

KILLER = {"id": 1, "name": "Bot", "power": "Power", "perk_1": "A", "perk_2": "B", "perk_3": "C"}


def team(difficulty):
    return [{"id": 10 + i, "name": f"S{i}", "difficulty": difficulty} for i in range(4)]


def enabled(state):
    return {a["id"] for a in h.available_actions(state) if a["enabled"]}


def naive(state):
    """Patrols, then chases. Nothing else."""
    can = enabled(state)
    if state["target"] is not None:
        return "chase"
    return "patrol" if "patrol" in can else "camp"


def decent(state):
    """Chases (power when ready), camps the hook when a death is close, kicks the last generators."""
    can = enabled(state)
    if state["target"] is not None:
        return "power" if "power" in can else "chase"
    hooked = [s for s in state["survivors"] if s["status"] == "hooked"]
    done = int(state["gen_total"] // h.GEN_NEEDED)
    progress = state["gen_total"] % h.GEN_NEEDED
    if hooked and min(s["timer"] for s in hooked) <= 2 and "camp" in can:
        return "camp"
    if done >= 3 and progress >= 50 and "kick" in can:
        return "kick"
    return "patrol" if "patrol" in can else ("camp" if "camp" in can else "kick")


def power_aware(state):
    """Like decent, but uses each kind of Killer power the way it is meant to be used."""
    can = enabled(state)
    kind = h._kind(state)
    if "power" in can:
        if kind in ("strike", "ranged", "frenzy") and state["target"] is not None:
            return "power"
        if kind in ("dash", "stalk", "trap", "regress") and state["target"] is None:
            return "power"
        if kind == "doom" and any(s["status"] == "hooked" and s["timer"] <= 2 for s in state["survivors"]):
            return "power"
    return decent(state)


def strong(state):
    """Like power_aware, plus each perk at a sensible moment (by what the perk does)."""
    can = enabled(state)
    hooked = [x for x in state["survivors"] if x["status"] == "hooked"]
    for slot in ("perk_1", "perk_2", "perk_3"):
        if slot not in can:
            continue
        kind = h._perk_kind_at(state, int(slot[-1]) - 1)
        if kind == "finisher":
            return slot
        if kind == "jam" and state["gen_total"] >= 3 * h.GEN_NEEDED:
            return slot
        if kind == "lockdown" and hooked and min(x["timer"] for x in hooked) >= 2:
            return slot
        if kind == "slow" and state.get("slow", 0) == 0:
            return slot
        if kind in ("tracker", "haste") and state["target"] is None:
            return slot
    return power_aware(state)


def play(policy, difficulty, level, prestige, seed):
    state = h.new_run(KILLER, team(difficulty), level, prestige, str(seed))
    while state["status"] == "active":
        h.step(state, policy(state))
    return state


def rate(policy, difficulty, level, prestige, runs=int(os.environ.get("RUNS", "3000"))):
    wins, turns, outcomes = 0, 0, Counter()
    for i in range(runs):
        s = play(policy, difficulty, level, prestige, i)
        wins += s["status"] == "won"
        turns += s["turn"]
        outcomes[s["outcome"]] += 1
    return wins / runs, turns / runs, outcomes


def by_power_kind(runs=int(os.environ.get("RUNS", "800"))):
    print("\n=== POWER KINDS: power_aware bot vs Intermediate Survivors (win rate)")
    examples = {"strike": "Dream Demon", "ranged": "Hunting Hatchets", "dash": "Chainsaw Sprint", "stalk": "Wailing Bell",
                "trap": "Bear Trap", "frenzy": "Feral Frenzy", "regress": "Vile Purge", "doom": "Rites of Judgement"}
    for kind, power in examples.items():
        KILLER["power"] = power
        row = f"{kind:<8}"
        for level, prestige in ((1, 0), (50, 0), (100, 100)):
            w, _, _ = rate(power_aware, "Intermediate", level, prestige, runs)
            row += f"  L{level}/P{prestige}: {w*100:3.0f}%"
        print(row)
    KILLER["power"] = "Power"


def by_killer(level, prestige, runs=int(os.environ.get("RUNS", "200"))):
    """Every Killer in the seed data, with their real power and perks."""
    import re
    seed = open(os.path.join(os.path.dirname(__file__), "..", "sql", "seed.sql"), encoding="utf-8").read()
    pat = re.compile(r"\s*\((\d+), '((?:[^']|'')*)', '[^']*', 'Killer', '[^']*', '(?:[^']|'')*', '(?:[^']|'')*', '(?:[^']|'')*', \d+, "
                     r"'((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '[^']*', '((?:[^']|'')*)'")
    rows = []
    for line in seed.splitlines():
        m = pat.match(line)
        if m:
            g = [x.replace("''", "'") for x in m.groups()]
            KILLER.update(id=int(g[0]), name=g[1], perk_1=g[2], perk_2=g[3], perk_3=g[4], power=g[5])
            w, _, _ = rate(strong, "Intermediate", level, prestige, runs)
            rows.append((w, g[1]))
    rows.sort()
    for w, name in rows:
        print(f"{w*100:3.0f}%  {name}")
    ws = [w for w, _ in rows]
    print(f"lowest {min(ws)*100:.0f}%  median {ws[len(ws)//2]*100:.0f}%  highest {max(ws)*100:.0f}%")


if __name__ == "__main__":
    if os.environ.get("KILLERS"):
        by_killer(*map(int, os.environ["KILLERS"].split(",")))
        sys.exit()
    if os.environ.get("POWERS"):
        by_power_kind()
        sys.exit()
    avatars = [(1, 0), (25, 0), (50, 0), (100, 0), (100, 25), (100, 100)]
    for name, policy in (("NAIVE (patrol + chase)", naive), ("DECENT", decent), ("STRONG (uses perks)", strong)):
        print(f"\n=== {name}: win rate by Survivor team difficulty  (avg turns in brackets)")
        print(f"{'avatar':<14}" + "".join(f"{d:>20}" for d in h.base.AGGRESSION))
        for level, prestige in avatars:
            row = f"L{level:<3} P{prestige:<7}"
            for d in h.base.AGGRESSION:
                w, turns, _ = rate(policy, d, level, prestige)
                row += f"{w*100:>13.0f}% ({turns:>4.1f})"
            print(row)
git status