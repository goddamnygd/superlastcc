/* Shared login + avatar module: ONE file for the Wiki, Minigame, DBDle and Trial, hosted by the hub (the Wiki).
   It builds its own button, modal and styles, so the pages only need <script src=".../shared/auth.js">.
   Login itself happens on the hub's login page (see config.js); this file holds the token of the site it runs on. */
(function () {
    "use strict";

    const D = window.DBD;
    const API = D.api;   // the hub's proxy: the real API address and key stay on the hub's server
    const TOKEN_KEY = D.TOKEN_KEY;
    const WIKI_URL = D.sites.wiki + "/";
    const GUEST_KEY = D.GUEST_KEY;
    const GUEST_PLAYS_KEY = "dbd_guest_plays";

    // Log out: clear this site AND the hub (otherwise the hub would sign the visitor straight back in)
    function goLogin(reason, logout) { location.replace(D.loginUrl({ reason: reason, logout: logout })); }

    let token = readToken();
    let user = null;
    let avatar = null;
    // Resolves once the first /me check has finished, so a page knows whether the visitor is really logged in
    let markReady;
    const ready = new Promise(resolve => { markReady = resolve; });

    // A guest is simply a visitor with no login token (gate.js only lets them in if they chose guest mode).
    // Guests get no avatar and no leveling, and can play each game mode once.
    function isGuest() { return !token; }

    // ---------- storage ----------
    function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
    function saveToken(t) {
        token = t;
        try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
    }

    // ---------- tiny DOM helper (textContent only, so API data can never inject HTML) ----------
    function el(tag, attrs, ...kids) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
            else if (k === "class") node.className = v;
            else node.setAttribute(k, v);
        }
        kids.flat(Infinity).forEach(c => { if (c != null) node.append(c.nodeType ? c : document.createTextNode(c)); });
        return node;
    }

    // ---------- API ----------
    async function api(path, { method = "GET", body } = {}) {
        const headers = {};
        if (body) headers["Content-Type"] = "application/json";
        if (token) headers["Authorization"] = "Bearer " + token;
        let res;
        try {
            res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
        } catch (e) {
            throw new Error("Cannot reach the server.");
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const first = data.errors && data.errors[0];
            const err = new Error(first ? first.message : (data.detail || "Request failed."));
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function refresh() {
        if (!token) { user = null; avatar = null; return paintButton(); }
        try {
            const data = await api("/me");
            user = data.user; avatar = data.avatar;
        } catch (e) {
            if (e.status === 401) { saveToken(null); return goLogin("expired"); }
            user = null; avatar = null;
        }
        paintButton();
    }

    // ---------- styles ----------
    const css = `
    .dbda-btn{margin-left:4px;padding:8px 12px;background:#c11111;border:1px solid #c11111;color:#fff;font:900 10px/1 Montserrat,Arial,sans-serif;letter-spacing:.08em;cursor:pointer;white-space:nowrap}
    .dbda-btn:hover{background:#751010;border-color:#751010}
    .dbda-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.88);overflow-y:auto}
    .dbda-box{position:relative;width:100%;max-width:440px;padding:28px;background:#101114;border:1px solid #751010;box-shadow:0 0 40px rgba(177,0,0,.28);color:#f4f4f4;font-family:Montserrat,Arial,sans-serif}
    .dbda-box.wide{max-width:640px}
    .dbda-box h2{font:400 32px/1 Anton,Impact,sans-serif;letter-spacing:.02em;margin-bottom:6px}
    .dbda-box p.sub{color:#9b9da2;font-size:13px;line-height:1.6;margin-bottom:18px}
    .dbda-x{position:absolute;top:8px;right:14px;background:none;border:0;color:#888;font-size:28px;cursor:pointer}
    .dbda-x:hover{color:#e22929}
    .dbda-box label{display:block;margin:12px 0 5px;color:#e22929;font-size:10px;font-weight:900;letter-spacing:.1em}
    .dbda-box input,.dbda-box select{width:100%;min-height:42px;padding:0 12px;background:#0d0d0d;border:1px solid #2a2a2a;color:#f4f4f4;font:700 13px Montserrat,Arial,sans-serif;outline:none}
    .dbda-box input:focus,.dbda-box select:focus{border-color:#c11111}
    .dbda-box input[type=checkbox]{width:auto;min-height:0}
    .dbda-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
    .dbda-b{min-height:40px;padding:0 18px;background:#c11111;border:1px solid #c11111;color:#fff;font:900 11px Montserrat,Arial,sans-serif;letter-spacing:.08em;cursor:pointer}
    .dbda-b:hover{background:#751010}
    .dbda-b.ghost{background:transparent;border-color:rgba(255,255,255,.35)}
    .dbda-b.ghost:hover{background:#fff;color:#000}
    .dbda-b:disabled{opacity:.4;cursor:wait}
    .dbda-err{min-height:18px;margin-top:12px;color:#ff4b4b;font-size:12px;font-weight:700}
    .dbda-link{background:none;border:0;color:#9b9da2;font:700 12px Montserrat,Arial,sans-serif;text-decoration:underline;cursor:pointer;margin-top:14px}
    .dbda-chip{display:inline-block;margin-left:8px;padding:3px 8px;border:1px solid #c11111;color:#e22929;font:900 9px Montserrat,Arial,sans-serif;letter-spacing:.1em;vertical-align:middle}
    .dbda-avatar{display:flex;gap:16px;align-items:center;margin-top:16px;padding:14px;background:#090909;border:1px solid #242424}
    .dbda-avatar img{width:72px;height:92px;object-fit:cover;object-position:top center;border:1px solid #751010;background:#0d0d0d}
    .dbda-avatar strong{display:block;font:400 24px Anton,Impact,sans-serif;letter-spacing:.02em}
    .dbda-lv{display:inline-block;margin-top:6px;padding:4px 10px;background:#c11111;font:900 11px Montserrat,Arial,sans-serif;letter-spacing:.1em}
    .dbda-avatar small{display:block;margin-top:6px;color:#9b9da2;font-size:11px}
    .dbda-tbl{width:100%;margin-top:14px;border-collapse:collapse;font-size:12px}
    .dbda-tbl th{text-align:left;padding:8px 6px;color:#e22929;font-size:10px;letter-spacing:.1em;border-bottom:1px solid #2a2a2a}
    .dbda-tbl td{padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.06)}
    .dbda-tbl select{min-height:32px;font-size:12px}
    .dbda-scroll{max-height:55vh;overflow:auto}
    .dbda-toast{position:fixed;left:50%;bottom:28px;z-index:3100;transform:translateX(-50%);max-width:90vw;padding:12px 20px;background:#101114;border:1px solid #c11111;color:#fff;font:800 12px Montserrat,Arial,sans-serif;letter-spacing:.05em;box-shadow:0 8px 30px rgba(0,0,0,.6);animation:dbdaIn .25s ease}
    .dbda-toast.levelup{background:#c11111;font-size:14px}
    .dbda-equip{margin-top:16px}
    .dbda-prog{margin-top:12px;padding:14px;background:#090909;border:1px solid #242424;font-size:12px;color:#c9cacd}
    .dbda-prog div.r{display:flex;justify-content:space-between;gap:12px;margin-top:6px}
    .dbda-bar{height:10px;margin-top:6px;background:#1a1a1a;border:1px solid #2a2a2a}
    .dbda-bar i{display:block;height:100%;background:#c11111}
    .dbda-bar.gold i{background:#d9a406}
    @keyframes dbdaIn{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
    `;
    document.head.append(el("style", {}, css));

    // ---------- toast ----------
    let toastTimer;
    function toast(message, kind) {
        document.querySelectorAll(".dbda-toast").forEach(t => t.remove());
        const t = el("div", { class: "dbda-toast " + (kind || ""), role: "status" }, message);
        document.body.append(t);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.remove(), kind === "levelup" ? 4500 : 3200);
    }

    // ---------- nav button ----------
    const navButton = el("button", { class: "dbda-btn", type: "button", onclick: () => open(user ? "account" : "login") }, "LOG IN");
    function paintButton() {
        navButton.textContent = user
            ? user.username.toUpperCase() + (avatar ? "  ·  " + (avatar.prestige ? "P" + avatar.prestige + " " : "") + "LV " + avatar.level : "")
            : "LOG IN";
    }
    function mountButton() {
        const nav = document.querySelector(".topbar nav");
        (nav || document.body).append(navButton);
    }

    // ---------- modal ----------
    let overlay = null;
    function close() { if (overlay) { overlay.remove(); overlay = null; } }
    function open(view) {
        close();
        const box = el("div", { class: "dbda-box" + (view === "admin" ? " wide" : "") },
            el("button", { class: "dbda-x", type: "button", "aria-label": "Close", onclick: close }, "×"));
        overlay = el("div", { class: "dbda-overlay", onmousedown: e => { if (e.target === overlay) close(); } }, box);
        document.body.append(overlay);
        ({ login: loginView, register: registerView, account: accountView, admin: adminView }[view] || loginView)(box);
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    function field(label, type, name, extra) {
        const input = el("input", Object.assign({ type, name, required: "", autocomplete: "off" }, extra || {}));
        return [el("label", {}, label), input];
    }

    // generic form that handles submit, busy state and error text
    function form(onSubmit, submitText, fields) {
        const err = el("div", { class: "dbda-err", "aria-live": "polite" });
        const btn = el("button", { class: "dbda-b", type: "submit" }, submitText);
        const f = el("form", {
            onsubmit: async e => {
                e.preventDefault();
                err.textContent = ""; btn.disabled = true;
                try { await onSubmit(Object.fromEntries(new FormData(f))); }
                catch (ex) { err.textContent = ex.message; }
                btn.disabled = false;
            }
        }, fields, err, el("div", { class: "dbda-row" }, btn));
        return f;
    }

    async function afterAuth(data) {
        try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* ignore */ }
        saveToken(data.token);
        await refresh();
        close();
        toast("Welcome, " + user.username + ".");
    }

    function loginView(box) {
        box.append(
            el("h2", {}, "LOG IN"),
            el("p", { class: "sub" }, "Welcome back. Log in to your account."),
            form(async v => afterAuth(await api("/auth/login", { method: "POST", body: { identifier: v.identifier, password: v.password } })),
                "LOG IN",
                [field("USERNAME OR EMAIL", "text", "identifier", { autocomplete: "username" }),
                 field("PASSWORD", "password", "password", { autocomplete: "current-password" })]),
            el("button", { class: "dbda-link", type: "button", onclick: () => open("register") }, "No account yet? Create one")
        );
    }

    function registerView(box) {
        box.append(
            el("h2", {}, "CREATE ACCOUNT"),
            el("p", { class: "sub" }, "Username: 3 to 30 letters, numbers or underscore. Password: at least 8 characters."),
            form(async v => afterAuth(await api("/auth/register", { method: "POST", body: { username: v.username, email: v.email, password: v.password } })),
                "CREATE ACCOUNT",
                [field("USERNAME", "text", "username", { autocomplete: "username", maxlength: "30" }),
                 field("EMAIL", "email", "email", { autocomplete: "email" }),
                 field("PASSWORD", "password", "password", { autocomplete: "new-password", minlength: "8", maxlength: "72" })]),
            el("button", { class: "dbda-link", type: "button", onclick: () => open("login") }, "Already have an account? Log in")
        );
    }

    const fmt = n => Number(n || 0).toLocaleString("en-US");
    function bar(percent, cls) {
        return el("div", { class: "dbda-bar " + (cls || "") }, el("i", { style: "width:" + Math.max(0, Math.min(100, percent)) + "%" }));
    }
    function progressView() {
        const prestige = avatar.prestige, prestigeBonus = avatar.prestige_bonus_xp;
        const atMax = avatar.level >= avatar.max_level;
        const levelPct = atMax ? 100 : (avatar.xp_into_level / avatar.xp_for_next_level) * 100;
        const box = el("div", { class: "dbda-prog" },
            el("div", { class: "r" }, el("span", {}, avatar.character.name.toUpperCase() + " · PRESTIGE " + prestige + " / 100"),
                el("span", {}, "+" + fmt(prestigeBonus) + " XP per game from Prestige")),
            el("div", { class: "r" }, el("span", {}, "XP"),
                el("span", {}, atMax ? "MAX LEVEL" : fmt(avatar.xp_into_level) + " / " + fmt(avatar.xp_for_next_level))),
            bar(levelPct),
            el("div", { class: "r" }, el("span", {}, "PROGRESS TO LEVEL " + avatar.max_level),
                el("span", {}, avatar.level_progress_percent + "%  (LV " + avatar.level + ")")),
            bar(avatar.level_progress_percent, "gold"));
        if (atMax && prestige < 100) {
            box.append(el("div", { class: "dbda-row" }, el("button", { class: "dbda-b", type: "button", onclick: doPrestige }, "PRESTIGE")));
        } else if (prestige >= 100) {
            box.append(el("div", { class: "r" }, el("span", {}, "MAXIMUM PRESTIGE REACHED")));
        }
        return box;
    }
    async function doPrestige() {
        if (!confirm("Prestige resets THIS character to level 1 and XP to 0. You keep its wins and it gains +25 XP per game forever. Continue?")) return;
        try {
            const r = await api("/me/avatar/prestige", { method: "POST" });
            avatar = r.avatar;
            const prestige = avatar.prestige, prestigeBonus = avatar.prestige_bonus_xp;
            paintButton(); open("account");
            toast(r.reached_max_prestige ? "MAX PRESTIGE REACHED! Prestige " + prestige : "PRESTIGE " + prestige + "! Now +" + fmt(prestigeBonus) + " XP per game", "levelup");
        } catch (e) { toast(e.message); }
    }

    function accountView(box) {
        if (!user) return loginView(box);
        const isAdmin = user.role === "admin";
        box.append(
            el("h2", {}, user.username.toUpperCase(), el("span", { class: "dbda-chip" }, isAdmin ? "ADMIN" : "PLAYER")),
            el("p", { class: "sub" }, user.email)
        );

        if (avatar && avatar.character) {
            const c = avatar.character;
            box.append(el("div", { class: "dbda-avatar" },
                el("img", { src: c.image || "", alt: c.name }),
                el("div", {},
                    el("strong", {}, c.name),
                    el("span", { class: "dbda-lv" }, "LEVEL " + avatar.level),
                    el("small", {}, avatar.wins + (avatar.wins === 1 ? " win" : " wins") + " · " + c.role))));
            box.append(progressView());
        } else {
            box.append(el("div", { class: "dbda-avatar" }, el("div", {},
                el("strong", {}, "NO AVATAR"),
                el("small", {}, "Open any character on the Wiki and press EQUIP AS AVATAR. Win games to level it up."))));
        }

        const row = el("div", { class: "dbda-row" });
        if (!avatar) row.append(el("a", { class: "dbda-b ghost", href: WIKI_URL, style: "display:inline-flex;align-items:center;text-decoration:none;color:#fff" }, "GO TO WIKI"));
        if (avatar) row.append(el("button", { class: "dbda-b ghost", type: "button", onclick: async () => {
            try { await api("/me/avatar", { method: "DELETE" }); avatar = null; paintButton(); open("account"); toast("Avatar removed."); }
            catch (e) { toast(e.message); }
        } }, "REMOVE AVATAR"));
        if (isAdmin) row.append(el("button", { class: "dbda-b ghost", type: "button", onclick: () => open("admin") }, "MANAGE USERS"));
        row.append(el("button", { class: "dbda-b", type: "button", onclick: () => { saveToken(null); user = null; avatar = null; paintButton(); close(); goLogin(null, true); } }, "LOG OUT"));
        row.append(el("button", { class: "dbda-b ghost", type: "button", onclick: async () => {
            try { await api("/auth/logout-all", { method: "POST" }); } catch (e) { /* token may already be dead */ }
            saveToken(null); user = null; avatar = null; paintButton(); close(); goLogin(null, true);
        } }, "LOG OUT EVERYWHERE"));
        box.append(row);
    }

    async function adminView(box) {
        box.append(el("h2", {}, "MANAGE USERS"), el("p", { class: "sub" }, "Change a role or disable an account. At least one active admin must always remain."));
        const holder = el("div", { class: "dbda-scroll" }, "Loading…");
        box.append(holder, el("div", { class: "dbda-row" }, el("button", { class: "dbda-b ghost", type: "button", onclick: () => open("account") }, "BACK")));
        try {
            const data = await api("/admin/users?limit=100");
            const body = el("tbody");
            data.users.forEach(u => {
                const role = el("select", { "aria-label": "Role of " + u.username },
                    el("option", { value: "1" }, "user"), el("option", { value: "2" }, "admin"));
                role.value = String(u.role_id);
                const active = el("input", { type: "checkbox", "aria-label": "Active: " + u.username });
                active.checked = u.is_active;
                const save = async (changes, undo) => {
                    try { await api("/admin/users/" + u.id, { method: "PATCH", body: changes }); toast("Saved " + u.username + "."); }
                    catch (e) { undo(); toast(e.message); }
                };
                role.addEventListener("change", () => { const prev = u.role_id; save({ role_id: Number(role.value) }, () => { role.value = String(prev); }); u.role_id = Number(role.value); });
                active.addEventListener("change", () => save({ is_active: active.checked }, () => { active.checked = !active.checked; }));
                body.append(el("tr", {}, el("td", {}, u.username), el("td", {}, role), el("td", {}, active)));
            });
            holder.replaceChildren(el("table", { class: "dbda-tbl" },
                el("thead", {}, el("tr", {}, el("th", {}, "USERNAME"), el("th", {}, "ROLE"), el("th", {}, "ACTIVE"))), body));
        } catch (e) { holder.textContent = e.message; }
    }

    // ---------- public API used by the pages ----------
    async function equip(characterId, name) {
        if (!token || !user) { toast("Log in first to equip an avatar."); open("login"); return; }
        try {
            const data = await api("/me/avatar", { method: "PUT", body: { character_id: Number(characterId) } });
            avatar = data.avatar; paintButton();
            toast(name + " is now your avatar (level " + avatar.level + ").");
        } catch (e) {
            if (e.status === 401) { saveToken(null); user = null; return goLogin("expired"); }
            toast(e.message);
        }
    }

    // Shows the result of a round the SERVER already judged (r = the "xp" object from a game endpoint).
    // The browser cannot report a win any more: the server only gives XP when it sees the correct guess itself.
    function showWin(r) {
        if (!r) return;
        if (r.avatar) { avatar = r.avatar; paintButton(); }
        if (r.reached_max_level) {
            toast("LEVEL " + avatar.max_level + " REACHED! Open your account to Prestige.", "levelup");
        } else if (r.leveled_up) {
            toast("LEVEL UP! " + avatar.character.name + " is now level " + avatar.level + " (+" + fmt(r.xp_gained) + " XP)", "levelup");
        } else if (r.xp_gained) {
            toast("+" + fmt(r.xp_gained) + " XP");
        } else if (r.reason === "no_avatar") {
            toast("You won! Equip an avatar on the Wiki to start leveling up.");
        }
    }

    function equipButton(characterId, name) {
        if (isGuest()) return el("span");   // guests do not see the avatar / leveling feature
        return el("button", { class: "dbda-b dbda-equip", type: "button", onclick: () => equip(characterId, name) }, "EQUIP AS AVATAR");
    }

    // Shows the player's own level + Prestige for one character (used in the Wiki's character details)
    function progressBox(characterId) {
        const box = el("div", { class: "dbda-prog" });
        if (isGuest()) return el("span");
        if (!token || !user) return box;
        box.textContent = "Loading your progress...";
        api("/me/progress/" + Number(characterId)).then(r => {
            const p = r.progress, atMax = p.level >= p.max_level;
            box.textContent = "";
            box.append(
                el("div", { class: "r" }, el("span", {}, "YOUR LEVEL"), el("span", {}, "LV " + p.level + " / " + p.max_level)),
                el("div", { class: "r" }, el("span", {}, "PRESTIGE"), el("span", {}, p.prestige + " / 100  (+" + fmt(p.prestige_bonus_xp) + " XP per game)")),
                el("div", { class: "r" }, el("span", {}, "XP"), el("span", {}, atMax ? "MAX LEVEL" : fmt(p.xp_into_level) + " / " + fmt(p.xp_for_next_level))),
                bar(atMax ? 100 : (p.xp_into_level / p.xp_for_next_level) * 100));
        }).catch(() => { box.remove(); });
        return box;
    }

    // ---------- guest limit: one round per game mode, then a sign-up pop-up ----------
    // The count is kept in this browser only, so it is a soft limit (clearing site data resets it).
    const memPlays = {};
    function readPlays() {
        try { return Object.assign({}, JSON.parse(localStorage.getItem(GUEST_PLAYS_KEY)) || {}, memPlays); }
        catch (e) { return Object.assign({}, memPlays); }
    }
    function markPlayed(key) {
        memPlays[key] = 1;
        try { const p = readPlays(); p[key] = 1; localStorage.setItem(GUEST_PLAYS_KEY, JSON.stringify(p)); } catch (e) { /* kept in memory */ }
    }

    let wall = null;
    function signupWall(onBack) {
        if (wall) return;
        const base = D.loginUrl();
        const linkStyle = "display:inline-flex;align-items:center;text-decoration:none;color:#fff";
        const dismiss = () => {
            if (!wall) return;
            wall.remove(); wall = null;
            document.removeEventListener("keydown", onKey);
            if (typeof onBack === "function") onBack();
        };
        const onKey = e => { if (e.key === "Escape") dismiss(); };
        const box = el("div", { class: "dbda-box", role: "dialog", "aria-modal": "true", "aria-label": "Sign up to continue" },
            el("button", { class: "dbda-x", type: "button", "aria-label": "Close", onclick: dismiss }, "×"),
            el("h2", {}, "SIGN UP TO CONTINUE"),
            el("p", { class: "sub" }, "You have used your free guest round for this mode. Create a free account to keep playing."),
            el("div", { class: "dbda-row" },
                el("a", { class: "dbda-b", href: base + "#register", style: linkStyle }, "CREATE ACCOUNT"),
                el("a", { class: "dbda-b ghost", href: base, style: linkStyle }, "LOG IN"),
                el("button", { class: "dbda-b ghost", type: "button", onclick: dismiss }, "NOT NOW")));
        wall = el("div", { class: "dbda-overlay", style: "z-index:3200", onmousedown: e => { if (e.target === wall) dismiss(); } }, box);
        document.body.append(wall);
        document.addEventListener("keydown", onKey);
    }

    // Call before starting a round. Logged-in players always pass. A guest passes once per key
    // (e.g. "minigame:perks", "dbdle:killer"); after that the sign-up pop-up shows and this returns false.
    function guestAllow(key, onBack) {
        if (!isGuest()) return true;
        if (readPlays()[key]) { signupWall(onBack); return false; }
        markPlayed(key);
        return true;
    }

    window.DBDAuth = { equip, equipButton, progressBox, showWin, api, ready, open, guestAllow, isGuest,
                       isLoggedIn: () => !!user, isAdmin: () => !!(user && user.role === "admin") };

    // ---------- admin answer key ----------
    // Admin accounts only (role comes from the server's /me). A game exposes its current answer through
    // window.DBDCheat.getAnswer(); the Wiki has none, so nothing is shown there.
    // NOTE: the answer already exists in the game's own page code, so this hides it from the screen,
    // it does not make it secret from someone who reads the page source.
    let cheatEl = null;
    setInterval(() => {
        const isAdmin = !!(user && user.role === "admin");
        const getAnswer = window.DBDCheat && window.DBDCheat.getAnswer;
        if (!isAdmin || typeof getAnswer !== "function") { if (cheatEl) { cheatEl.remove(); cheatEl = null; } return; }
        if (!cheatEl) {
            cheatEl = el("div", { style: "position:fixed;left:4px;bottom:2px;z-index:2000;font:6px/1 monospace;color:rgba(255,255,255,.35);pointer-events:none;user-select:none" });
            document.body.append(cheatEl);
        }
        let text = "";
        try { text = getAnswer() || ""; } catch (e) { /* game not ready */ }
        if (cheatEl.textContent !== text) cheatEl.textContent = text;
    }, 400);

    // ---------- start ----------
    function start() {
        mountButton(); paintButton();
        refresh().then(() => {
            markReady();
            // sent here by a game because no avatar is equipped yet
            if (new URLSearchParams(location.search).get("avatar") === "required" && !avatar) {
                toast("Pick an avatar first: open a character and press EQUIP AS AVATAR.", "levelup");
            }
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
