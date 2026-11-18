/* Login and sign-up page. Talks to the API and stores the token under the same key auth.js uses. */
(function () {
    "use strict";
    var API = "https://superlastcc.vercel.app/api/v1";
    var TOKEN_KEY = "dbd_token";

    var $ = function (id) { return document.getElementById(id); };
    var tabs = { login: $("tabLogin"), register: $("tabRegister") };
    var panels = { login: $("panelLogin"), register: $("panelRegister") };
    var params = new URLSearchParams(location.search);

    // Only these pages may be opened after login (stops a crafted ?next= from sending people elsewhere)
    function safeNext() {
        var n = params.get("next") || "";
        return /^(index|game)\.html(\?[A-Za-z0-9_=&.\-]*)?$/.test(n) ? n : "index.html";
    }

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
        if (!data.token || !saveToken(data.token)) {
            throw new Error("Your browser blocked saving the login. Turn off private mode or allow site data, then try again.");
        }
        location.replace(safeNext());
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

    // Messages from the gate
    if (params.get("reason") === "expired") {
        $("notice").textContent = "Your session ended. Please log in again.";
        $("notice").hidden = false;
    }

    // Already logged in? Skip this page.
    var existing = getToken();
    if (existing) {
        fetch(API + "/me", { headers: { Authorization: "Bearer " + existing }, cache: "no-store" })
            .then(function (r) { if (r.ok) location.replace(safeNext()); else { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} } })
            .catch(function () {});
    }

    show(location.hash === "#register" ? "register" : "login");
})();
