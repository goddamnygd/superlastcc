/* The Trial (Survivor Escape).
   The server plays the whole game: this page only shows what the server sends and tells it which action
   the player chose. It never knows the Killer's next move, the dice, or the exact distance. */
(function () {
    "use strict";

    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    };

    const HEARTBEAT = ["SILENT", "FAINT", "POUNDING", "CHASE"];
    const HUNT_TEXT = {
        won: ["THE ENTITY IS PLEASED", "YOU CLAIMED THEM"],
        sacrificed: ["SACRIFICED", "Three Survivors were offered to the Entity. The hunt is yours."],
        gates_open: ["THEY ESCAPED", "The last generator roared to life and the gates opened. They got away."],
        out_of_time: ["LOST IN THE FOG", "You took too long. The Survivors slipped away into the fog."]
    };
    const STATUS_LABEL = { healthy: "HEALTHY", injured: "INJURED", hooked: "HOOKED", dead: "SACRIFICED" };
    const HELP = {
        patrol: "Search for a Survivor to chase. Might find no one.",
        chase: "Attack the Survivor you are chasing. A healthy one gets injured, an injured one is hooked.",
        camp: "Wait beside the hook. Rescues become much less likely this turn.",
        kick: "Undo generator progress (finished generators stay finished).",
        power: "Your Killer power. It recharges after each use.",
        tracker: "Find a target for sure and strike with a bonus. One use.",
        jam: "Undo a lot of generator progress and stop all repairs this turn. One use.",
        finisher: "A hooked Survivor is sacrificed on the spot. One use.",
        repair: "Work on the generator. Noisy: the Killer is more likely to find you.",
        hide: "Stay out of sight. Much harder to find, but no progress.",
        run: "Break line of sight. Best when the Killer is close.",
        heal: "Recover one health.",
        tempo: "Slip away: the Killer loses ground and cannot hit you this turn. One use.",
        defense: "Absorb the next hit. One use.",
        push: "A big burst of generator progress. One use."
    };

    let run = null;        // what the server last told us about the active run
    let busy = false;
    let info = null;       // /trial/current

    // menu button (same as the other sites)
    $("menuBtn").addEventListener("click", () => $("navMenu").classList.toggle("open"));

    function show(which) {
        ["loading", "lobby", "arena", "result"].forEach(id => $(id).classList.toggle("hidden", id !== which));
    }

    function note(node, text) { node.textContent = text || ""; }

    async function call(path, method, body) {
        try {
            return await DBDAuth.api(path, { method: method || "GET", body });
        } catch (e) {
            if (e.status === 401) { location.replace("login.html?reason=expired"); }
            throw e;
        }
    }

    // ---------------- lobby ----------------
    async function loadLobby() {
        show("loading");
        try {
            info = await call("/trial/current");
        } catch (e) {
            note($("loading"), e.message);
            return;
        }
        if (info.run) { run = info.run; return showRun(); }
        renderLobby();
        $("statsRow").replaceChildren();      // do not show the previous numbers while the new ones load
        show("lobby");
        try {
            const data = await call("/trial/stats");
            renderStats(data.stats);
        } catch (e) { /* stats are optional */ }
    }

    function lobbyTexts() {
        const hunt = info.mode === "hunt";
        $("lobbyKicker").textContent = hunt ? "KILLER HUNT" : "SURVIVOR ESCAPE";
        $("lobbyTitle").textContent = hunt ? "HUNT THEM DOWN" : "ESCAPE THE TRIAL";
        $("lobbyLead").textContent = hunt
            ? "Four Survivors are repairing five generators. Sacrifice three of them before the last generator is done. " +
              "Level up your Killer in the Minigame and DBDle: a stronger avatar hits more often, finds Survivors faster and slows their repairs. " +
              "Your perks unlock as moves. To play a Survivor instead, equip one on the Wiki."
            : "Repair three generators before the Killer catches you. Level up your avatar in the Minigame and DBDle: " +
              "a stronger avatar repairs faster, is harder to find and unlocks its perks as moves. To play a Killer instead, equip one on the Wiki.";
        $("startBtn").textContent = hunt ? "START THE HUNT" : "ENTER THE TRIAL";
    }

    function renderLobby() {
        lobbyTexts();
        const card = $("avatarCard");
        card.replaceChildren();
        const a = info.avatar;
        if (a) {
            const c = a.character;
            const img = el("img");
            img.alt = c.name; img.src = c.image || "";
            const text = el("div");
            text.append(el("span", "tag", c.role.toUpperCase() + " AVATAR"), el("strong", null, c.name),
                el("small", null, "LEVEL " + a.level + (a.prestige ? "  ·  PRESTIGE " + a.prestige : "")));
            card.append(img, text);
        }

        const row = $("perkRow");
        row.replaceChildren();
        const unlocks = info.perk_unlock_levels || {};
        ["perk_1", "perk_2", "perk_3"].forEach((slot, i) => {
            const need = unlocks[slot];
            const open = a && a.level >= need;
            const chip = el("div", "perk-chip" + (open ? " open" : ""));
            chip.append(el("span", "tag", "PERK " + (i + 1)), el("strong", null, open ? "UNLOCKED" : "LEVEL " + need));
            row.append(chip);
        });

        $("startBtn").disabled = !info.can_play;
        note($("lobbyNote"), info.reason || "");
    }

    function renderStats(stats) {
        const row = $("statsRow");
        row.replaceChildren();
        const mine = (stats || []).find(s => info.avatar && s.character && s.character.id === info.avatar.character_id);
        const total = (stats || []).reduce((n, s) => ({ runs: n.runs + s.runs, wins: n.wins + s.wins }), { runs: 0, wins: 0 });
        const cell = (label, value) => {
            const d = el("div", "stat");
            d.append(el("span", "tag", label), el("strong", null, String(value)));
            return d;
        };
        row.append(cell("YOUR WINS", total.wins + " / " + total.runs),
            cell("THIS AVATAR", mine ? mine.wins + " / " + mine.runs : "0 / 0"),
            cell("BEST STREAK", mine ? mine.best_streak : 0));
    }

    async function startRun() {
        if (busy) return;
        busy = true;
        $("startBtn").disabled = true;
        try {
            const data = await call("/trial/start", "POST");
            run = data.run;
            busy = false;
            showRun();
            return;
        } catch (e) {
            // e.g. the avatar changed to a Killer: go back to the lobby and show why
            busy = false;
            await loadLobby();
            note($("lobbyNote"), e.message);
            return;
        }
    }
    $("startBtn").addEventListener("click", startRun);

    // ---------------- the trial ----------------
    function showRun() {
        if (run.status !== "active") return showResult();
        renderArena();
        show("arena");
    }

    function pips(container, filled, total) {
        container.replaceChildren();
        for (let i = 0; i < total; i++) {
            const p = el("span", "pip" + (i < filled ? " on" : ""));
            container.append(p);
        }
    }

    function renderArena() {
        const hunt = run.mode === "hunt";
        document.querySelectorAll(".hunt-only").forEach(n => n.classList.toggle("hidden", !hunt));
        document.querySelectorAll(".escape-only").forEach(n => n.classList.toggle("hidden", hunt));
        const k = run.killer;
        $("killerImage").src = k.image || "";
        $("killerImage").alt = k.name;
        $("killerName").textContent = k.name;
        $("turnCount").textContent = run.turn + " / " + run.max_turns;

        if (hunt) {
            $("killerTag").textContent = "YOUR KILLER";
            $("killerMeta").textContent = (k.power ? k.power + "  ·  " : "") + "LEVEL " + run.level + (run.prestige ? "  ·  PRESTIGE " + run.prestige : "");
            renderHunt();
        } else {
            $("killerTag").textContent = "THE KILLER";
            $("killerMeta").textContent = (k.power ? k.power + "  ·  " : "") + k.difficulty.toUpperCase();
            renderEscape();
        }
        renderLogAndActions();
    }

    function renderHunt() {
        pips($("huntGenPips"), run.generators.done, run.generators.needed);
        $("huntGenBar").style.width = run.generators.progress_percent + "%";
        pips($("sacPips"), run.sacrifices.done, run.sacrifices.needed);
        $("sacLabel").textContent = run.sacrifices.done + " OF " + run.sacrifices.needed + " NEEDED";
        $("powerName").textContent = run.power.name;
        $("powerName").title = run.power.help || "";
        $("powerStatus").textContent = run.power.cooldown ? "RECHARGING (" + run.power.cooldown + ")" : "READY";

        const grid = $("survivorGrid");
        grid.replaceChildren();
        run.survivors.forEach(s => {
            const card = el("div", "survivor " + s.status + (s.targeted ? " targeted" : ""));
            const img = el("img");
            img.alt = s.name; img.src = s.image || "";
            const info = el("div");
            info.append(el("strong", null, s.name));
            let label = STATUS_LABEL[s.status];
            if (s.status === "hooked") label += " · " + s.timer + (s.timer === 1 ? " TURN LEFT" : " TURNS LEFT");
            info.append(el("small", null, label));
            if (s.targeted) info.append(el("span", "chip", "CHASING"));
            card.append(img, info);
            grid.append(card);
        });
    }

    function renderEscape() {
        pips($("genPips"), run.generators.done, run.generators.needed);
        $("genBar").style.width = run.generators.progress_percent + "%";
        pips($("hpPips"), run.hp, run.max_hp);

        const chips = $("statusChips");
        chips.replaceChildren();
        if (run.hidden) chips.append(el("span", "chip", "HIDDEN"));
        if (run.shield) chips.append(el("span", "chip", "SHIELDED"));

        const hb = $("heartbeat");
        hb.replaceChildren();
        for (let i = 0; i < 4; i++) hb.append(el("span", "hb" + (i <= run.heartbeat ? " on l" + run.heartbeat : "")));
        hb.dataset.level = String(run.heartbeat);
        $("heartbeatLabel").textContent = HEARTBEAT[run.heartbeat];
    }

    function renderLogAndActions() {
        const log = $("log");
        log.replaceChildren();
        run.log.forEach((line, i) => log.append(el("li", i === run.log.length - 1 ? "latest" : "", line)));

        const actions = $("actions");
        actions.replaceChildren();
        run.actions.forEach(a => {
            const isPerk = a.id.startsWith("perk");
            const b = el("button", "act" + (isPerk ? " perk" : ""));
            b.type = "button";
            b.disabled = !a.enabled || busy;
            b.append(el("strong", null, a.label.toUpperCase()));
            b.append(el("small", null, a.enabled ? (isPerk ? "PERK · ONCE" : a.kind === "power" ? "POWER" : "") : (a.reason || "")));
            b.title = a.help || HELP[a.kind || a.id] || "";
            b.addEventListener("click", () => act(a.id));
            actions.append(b);
        });
        note($("arenaMessage"), "");
    }

    async function act(action) {
        if (busy || !run) return;
        busy = true;
        document.querySelectorAll(".act").forEach(b => { b.disabled = true; });
        try {
            const data = await call("/trial/action", "POST", { action, turn: run.turn });
            run = data.run;
            busy = false;
            showRun();
            return;
        } catch (e) {
            note($("arenaMessage"), e.message);
            if (e.status === 409) {            // out of sync: ask the server where we really are
                busy = false;
                return loadLobby();
            }
        }
        busy = false;
        renderArena();
    }

    $("abandonBtn").addEventListener("click", async () => {
        if (busy || !confirm("Abandon this trial? It will not count as a win or a loss.")) return;
        busy = true;
        try { await call("/trial/abandon", "POST"); run = null; busy = false; await loadLobby(); return; }
        catch (e) { note($("arenaMessage"), e.message); }
        busy = false;
    });

    // ---------------- result ----------------
    function showResult() {
        const won = run.status === "won";
        const hunt = run.mode === "hunt";
        const why = (hunt ? HUNT_TEXT : {
            escaped: ["ESCAPED", "The gates are powered. You slip into the fog and live to repair another day."],
            caught: ["CAUGHT", "The Killer ran you down. The Entity claims you."],
            out_of_time: ["LOST IN THE FOG", "You took too long. The Entity grew bored and claimed you."]
        })[run.outcome] || ["OVER", ""];
        $("resultKicker").textContent = hunt ? (won ? "THE HUNT IS YOURS" : "THE HUNT FAILED") : (won ? "YOU SURVIVED" : "YOU DIED");
        $("resultTitle").textContent = why[0];
        $("resultText").textContent = why[1] + (hunt
            ? " (" + run.turn + " turns, " + run.sacrifices.done + " sacrifices)"
            : " (" + run.turn + " turns against " + run.killer.name + ")");
        const log = $("resultLog");
        log.replaceChildren();
        run.log.forEach(line => log.append(el("li", null, line)));
        $("result").classList.toggle("won", won);
        show("result");
    }

    $("againBtn").addEventListener("click", () => { run = null; startRun(); });
    $("lobbyBtn").addEventListener("click", () => { run = null; loadLobby(); });

    // ---------------- start ----------------
    (async function start() {
        await DBDAuth.ready;
        if (!DBDAuth.isLoggedIn()) {
            show("loading");
            const p = $("loading");
            p.textContent = "The Trial needs an account. ";
            const a = el("a", "inline-link", "Log in or create one");
            a.href = "login.html?next=index.html";
            p.append(a, document.createTextNode("."));
            return;
        }
        loadLobby();
    })();
})();
