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


def strong(state):
    """Like decent, plus perk moves at good moments."""
    can = enabled(state)
    if "perk_3" in can:
        return "perk_3"
    if "perk_2" in can and state["gen_total"] >= 3 * h.GEN_NEEDED:
        return "perk_2"
    if "perk_1" in can and state["target"] is None:
        return "perk_1"
    return decent(state)


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


if __name__ == "__main__":
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
