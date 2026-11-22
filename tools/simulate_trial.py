"""Balance check for the Escape engine: bots of different skill play thousands of runs.
Run:  python3 tools/simulate_trial.py          (no database needed)
Use it after changing any number in api/_trial.py to see what happens to win rates."""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import _trial as t  # noqa: E402

SURVIVOR = {"id": 1, "name": "Bot", "perk_1": "A", "perk_2": "B", "perk_3": "C"}


def killer(difficulty):
    return {"id": 2, "name": "K", "difficulty": difficulty, "movement_speed": "4.0", "terror_radius": "32", "power": "x"}


def enabled(state):
    return {a["id"] for a in t.available_actions(state) if a["enabled"]}


def naive(state):
    """Always repairs."""
    return "repair"


def decent(state):
    """Repairs when safe, hides or runs when the Killer is near, heals when injured and calm."""
    can, hb, hp = enabled(state), t.heartbeat(state), state["hp"]
    if hb >= 3:
        return "run"
    if hb == 2:
        return "hide"
    if hp < t.MAX_HP and hb == 0 and "heal" in can:
        return "heal"
    return "repair"


def strong(state):
    """Like decent, and spends each perk move at a sensible moment (by what the perk does)."""
    can, hb, hp = enabled(state), t.heartbeat(state), state["hp"]
    for slot in ("perk_1", "perk_2", "perk_3"):
        if slot not in can:
            continue
        kind = t._perk_kind_at(state, int(slot[-1]) - 1)
        if kind == "defense" and hb >= 2:
            return slot
        if kind == "tempo" and hb >= 3 and hp <= 2:
            return slot
        if kind == "push" and hb <= 1:
            return slot
        if kind == "heal" and hp <= 2 and hb <= 1:
            return slot
        if kind == "stealth" and hb >= 1:
            return slot
    return decent(state)


def play(policy, difficulty, level, prestige, seed):
    state = t.new_run(killer(difficulty), SURVIVOR, level, prestige, str(seed))
    while state["status"] == "active":
        t.step(state, policy(state))
    return state


def rate(policy, difficulty, level, prestige, runs=3000):
    wins, turns = 0, 0
    outcomes = Counter()
    for i in range(runs):
        s = play(policy, difficulty, level, prestige, i)
        wins += s["status"] == "won"
        turns += s["turn"]
        outcomes[s["outcome"]] += 1
    return wins / runs, turns / runs, outcomes


def by_survivor(level, prestige, runs=int(os.environ.get("RUNS", "200"))):
    """Every Survivor in the seed data, with their real perks, against Intermediate Killers."""
    import re
    global SURVIVOR
    seed = open(os.path.join(os.path.dirname(__file__), "..", "sql", "seed.sql"), encoding="utf-8").read()
    pat = re.compile(r"\s*\((\d+), '((?:[^']|'')*)', '[^']*', 'Survivor', '[^']*', '(?:[^']|'')*', '(?:[^']|'')*', '(?:[^']|'')*', \d+, "
                     r"'((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'")
    rows = []
    for line in seed.splitlines():
        m = pat.match(line)
        if m:
            g = [x.replace("''", "'") for x in m.groups()]
            SURVIVOR = {"id": int(g[0]), "name": g[1], "perk_1": g[2], "perk_2": g[3], "perk_3": g[4]}
            w, _, _ = rate(strong, "Intermediate", level, prestige, runs)
            rows.append((w, g[1]))
    rows.sort()
    for w, name in rows[:4] + rows[-4:]:
        print(f"{w*100:3.0f}%  {name}")
    ws = [w for w, _ in rows]
    print(f"lowest {min(ws)*100:.0f}%  median {ws[len(ws)//2]*100:.0f}%  highest {max(ws)*100:.0f}%")


if __name__ == "__main__":
    if os.environ.get("SURVIVORS"):
        by_survivor(*map(int, os.environ["SURVIVORS"].split(",")))
        sys.exit()
    avatars = [(1, 0), (25, 0), (50, 0), (100, 0), (100, 25), (100, 100)]
    for name, policy in (("NAIVE (always repair)", naive), ("DECENT", decent), ("STRONG (uses perks)", strong)):
        print(f"\n=== {name}: win rate by killer difficulty  (avg turns in brackets)")
        print(f"{'avatar':<14}" + "".join(f"{d:>20}" for d in t.AGGRESSION))
        for level, prestige in avatars:
            row = f"L{level:<3} P{prestige:<7}"
            for d in t.AGGRESSION:
                w, turns, _ = rate(policy, d, level, prestige)
                row += f"{w*100:>13.0f}% ({turns:>4.1f})"
            print(row)
    print("\nBonus per avatar:", {f"L{l}P{p}": round(t.power_bonus(l, p) * 100, 1) for l, p in avatars})
