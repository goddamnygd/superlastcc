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
    """Like decent, and spends perk moves at the right moment."""
    can, hb, hp = enabled(state), t.heartbeat(state), state["hp"]
    if "perk_2" in can and hb >= 2:
        return "perk_2"
    if "perk_1" in can and hb >= 3 and hp <= 2:
        return "perk_1"
    if "perk_3" in can and hb <= 1:
        return "perk_3"
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


if __name__ == "__main__":
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
