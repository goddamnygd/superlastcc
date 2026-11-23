/* THE login page for all four sites. It lives on the hub (the Wiki).
   A site sends visitors here with ?return=<page they wanted>. After login (or guest) they are sent back
   there with the token in the URL #fragment, which that site's config.js saves.
   The hub's own storage also keeps the login, so the next site a visitor opens is bounced straight back. */
(function () {
    "use strict";
    var D = window.DBD;
    var API = D.api;
    var TOKEN_KEY = D.TOKEN_KEY;
    var GUEST_KEY = D.GUEST_KEY;

    var $ = function (id) { return document.getElementById(id); };
    var tabs = { login: $("tabLogin"), register: $("tabRegister") };
    var panels = { login: $("panelLogin"), register: $("panelRegister") };
    var params = new URLSearchParams(location.search);

    // Where to send the visitor afterwards. Only a page of one of OUR four sites is accepted
    // (stops a crafted ?return= from sending people, and their token, anywhere else).
    function safeReturn() {
        var u;
        try { u = new URL(params.get("return") || ""); } catch (e) { return null; }
        if (!D.siteKey(u.origin)) return null;
        if (!/^\/((index|game)\.html)?$/.test(u.pathname)) return null;
        if (u.search && !/^\?[A-Za-z0-9_=&.\-]*$/.test(u.search)) return null;
        return u.origin + u.pathname + u.search;
    }
    function goBack(handoff) { location.replace((safeReturn() || D.sites.wiki + "/") + (handoff || "")); }
    function returnSite() { var r = safeReturn(); return r ? D.siteKey(new URL(r).origin) : "wiki"; }

    // The page looks like the site the visitor came from
    var BRANDS = {
        wiki:     { name: "THE WIKI", head: ["THE", "WIKI"], tag: "Every Survivor and Killer, one searchable database.", chips: ["SURVIVORS", "KILLERS", "PERKS & POWERS"], lead: "Log in, create a free account, or continue as a guest to browse the roster.", guest: "No account? Browse the Wiki as a guest." },
        minigame: { name: "THE MINIGAME", head: ["THE", "MINIGAME"], tag: "Win matches, equip your avatar and level it up.", chips: ["PLAY", "LEVEL UP", "PRESTIGE"], lead: "Log in, create a free account, or continue as a guest.", guest: "No account? Try each game mode once as a guest." },
        dbdle:    { name: "DBDLE", head: ["", "DBDLE"], tag: "Guess the daily character from the clues.", chips: ["DAILY", "GUESS", "STREAK"], lead: "Log in, create a free account, or continue as a guest.", guest: "No account? Try each game mode once as a guest." },
        trial:    { name: "THE TRIAL", head: ["THE", "TRIAL"], tag: "Survive the fog. Escape the Killer with your levelled-up avatar.", chips: ["ESCAPE", "PERKS", "SURVIVE"], lead: "Log in or create a free account to enter a trial.", guest: null }
    };
    (function brand() {
        var site = returnSite();
        var b = BRANDS[site] || BRANDS.wiki;
        document.title = "Log in - Dead bai Daylight " + b.name;
        $("brandTitle").textContent = b.name;
        var h = $("introHead"); h.textContent = "";
        if (b.head[0]) { h.append(document.createTextNode(b.head[0]), document.createElement("br")); }
        var em = document.createElement("em"); em.textContent = b.head[1]; h.append(em);
        $("introTag").textContent = b.tag;
        var chips = $("introChips"); chips.textContent = "";
        b.chips.forEach(function (c) { var s = document.createElement("span"); s.textContent = c; chips.append(s); });
        $("loginLead").textContent = b.lead;
        var box = document.querySelector(".guest-box");
        if (box) { if (b.guest) $("guestNote").textContent = b.guest; else box.remove(); }   // the Trial needs an account
    })();

    function saveToken(t) { try { localStorage.setItem(TOKEN_KEY, t); return true; } catch (e) { return false; } }
    function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

    async function post(path, body) {
        var res;
        try {
            res = await fetch(API + path, {
                method: "POST", cache: "no-store",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
            });
        } catch (e) { throw new Error("Cannot reach the server. Check your internet and try again."); }
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            var first = data.errors && data.errors[0];
            throw new Error(first ? first.message : (data.detail || "Something went wrong. Please try again."));
        }
        return data;
    }

    function show(view) {
        Object.keys(tabs).forEach(function (k) {
            var on = k === view;
            tabs[k].setAttribute("aria-selected", on ? "true" : "false");
            tabs[k].tabIndex = on ? 0 : -1;
            panels[k].hidden = !on;
        });
        $("loginError").textContent = ""; $("registerError").textContent = "";
        var first = panels[view].querySelector("input");
        if (first) first.focus();
        history.replaceState(null, "", "#" + view);
    }
    tabs.login.addEventListener("click", function () { show("login"); });
    tabs.register.addEventListener("click", function () { show("register"); });
    document.querySelectorAll("[data-switch]").forEach(function (b) {
        b.addEventListener("click", function () { show(b.getAttribute("data-switch")); });
    });
    // Arrow keys move between the two tabs
    [tabs.login, tabs.register].forEach(function (t) {
        t.addEventListener("keydown", function (e) {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") { var v = t === tabs.login ? "register" : "login"; show(v); tabs[v].focus(); }
        });
    });

    // Show / hide password
    document.querySelectorAll(".toggle-pw").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var input = $(btn.getAttribute("data-for"));
            var hidden = input.type === "password";
            input.type = hidden ? "text" : "password";
            btn.textContent = hidden ? "HIDE" : "SHOW";
            btn.setAttribute("aria-pressed", hidden ? "true" : "false");
        });
    });

    function finish(data) {
        try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* ignore */ }   // a real account replaces guest mode
        if (!data.token || !saveToken(data.token)) {
            throw new Error("Your browser blocked saving the login. Turn off private mode or allow site data, then try again.");
        }
        goBack("#dbd_token=" + encodeURIComponent(data.token));
    }

    function wire(formId, errId, btnId, work) {
        var form = $(formId), err = $(errId), btn = $(btnId), label = btn.textContent;
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            err.textContent = ""; btn.disabled = true; btn.textContent = "PLEASE WAIT…";
            try { await work(Object.fromEntries(new FormData(form))); }
            catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = label; }
        });
    }

    wire("loginForm", "loginError", "loginBtn", async function (v) {
        finish(await post("/auth/login", { identifier: v.identifier.trim(), password: v.password }));
    });

    wire("registerForm", "registerError", "registerBtn", async function (v) {
        var username = v.username.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(username)) throw new Error("Username must be 3-30 characters: letters, numbers and underscore only.");
        if (v.password.length < 8) throw new Error("Password must be at least 8 characters.");
        if (new TextEncoder().encode(v.password).length > 72) throw new Error("Password is too long (72 bytes max).");
        if (v.password !== v.confirm) throw new Error("The two passwords do not match.");
        finish(await post("/auth/register", { username: username, email: v.email.trim(), password: v.password }));
    });

    // Continue as guest
    var guestBtn = $("guestBtn");
    if (guestBtn) {
        guestBtn.addEventListener("click", function () {
            try { localStorage.setItem(GUEST_KEY, "1"); }
            catch (e) {
                $("notice").textContent = "Your browser blocked saving guest mode. Turn off private mode or allow site data, then try again.";
                $("notice").hidden = false;
                return;
            }
            goBack("#dbd_guest=1");
        });
    }

    // Messages from the gate
    if (params.get("reason") === "expired") {
        $("notice").textContent = "Your session ended. Please log in again.";
        $("notice").hidden = false;
    }

    function clearHub() { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(GUEST_KEY); } catch (e) { /* ignore */ } }

    // Log out (the visitor logged out on a site) or an expired session: forget the hub's login too,
    // otherwise this page would send them straight back in. Then show the form.
    var existing = getToken();
    if (params.get("logout") === "1") {
        clearHub();
        history.replaceState(null, "", location.pathname + "?return=" + encodeURIComponent(safeReturn() || D.sites.wiki + "/") + "#login");
    } else if (params.get("reason") === "expired") {
        clearHub();
    } else if (existing) {
        // Already logged in here? Send them back to the page they wanted, token included.
        fetch(API + "/me", { headers: { Authorization: "Bearer " + existing }, cache: "no-store" })
            .then(function (r) { if (r.ok) goBack("#dbd_token=" + encodeURIComponent(existing)); else clearHub(); })
            .catch(function () {});
    } else if (params.get("silent") === "1" && returnSite() !== "trial") {
        // A guest on one site is a guest on the others (the Trial always needs an account)
        var guest = null; try { guest = localStorage.getItem(GUEST_KEY); } catch (e) { /* ignore */ }
        if (guest === "1") goBack("#dbd_guest=1");
    }

    show(location.hash === "#register" ? "register" : "login");
})();
