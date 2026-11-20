"""Keeps the shared site files identical across all four websites.
The Wiki's copy is the master. Edit web1-wiki/auth.js (etc.), then run:

    python3 tools/sync_shared.py          copy the master files into the other sites
    python3 tools/sync_shared.py --check  only report differences (exit code 1 if any)

Shared: auth.js, login.js, login.css, gate.js.
(bgmedia.js and login.html are NOT synced: each site has its own text or media settings.)"""
import filecmp
import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MASTER = "web1-wiki"
SITES = ["web2-minigame", "web3-dbdle", "web4-trial"]
FILES = ["auth.js", "login.js", "login.css", "gate.js"]

check_only = "--check" in sys.argv
different = 0
for site in SITES:
    for name in FILES:
        src, dst = os.path.join(ROOT, MASTER, name), os.path.join(ROOT, site, name)
        same = os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False)
        if same:
            continue
        different += 1
        print(("DIFFERS  " if check_only else "copying  ") + f"{MASTER}/{name} -> {site}/{name}")
        if not check_only:
            shutil.copyfile(src, dst)
print("all shared files are identical" if not different else f"{different} file(s) " + ("differ" if check_only else "updated"))
sys.exit(1 if (check_only and different) else 0)
