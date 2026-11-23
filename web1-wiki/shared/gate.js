/* Login gate. Loaded in the <head> of every page of every site (after config.js), so the page stays
   hidden until the visitor is confirmed to be logged in. No login = redirect to the HUB's login page,
   which sends them back here afterwards. If they already logged in on another site, the hub sends
   them straight back with their token, so they never type anything twice.
   NOTE: this guards the pages. The API checks the token again on every request. */
(function () {
    "use strict";
    var D = window.DBD;
    if (!D) return;                       // config.js did not load: the API still refuses anything private
    var API = D.api;
    var root = document.documentElement;
    // Pages that need an equipped avatar (the games) load this as: <script src=".../gate.js" data-require-avatar>
    var needsAvatar = !!(document.currentScript && document.currentScript.hasAttribute("data-require-avatar"));

    function getToken() { try { return localStorage.getItem(D.TOKEN_KEY); } catch (e) { return null; } }
    function clearToken() { try { localStorage.removeItem(D.TOKEN_KEY); } catch (e) { /* ignore */ } }
    function reveal() { root.style.visibility = ""; }
    function isGuest() { try { return localStorage.getItem(D.GUEST_KEY) === "1"; } catch (e) { return false; } }

    function toLogin(reason) {
        // "silent": if the hub already knows this visitor (logged in, or chose guest) it sends them straight back
        location.replace(D.loginUrl({ reason: reason, silent: !reason }));
    }

    var token = getToken();
    if (!token) {
        // Guest: no login needed. The page stays visible, and the games do not require an avatar.
        // The Trial always needs an account, so a leftover guest flag must not let anyone in there
        if (isGuest() && D.siteKey(location.origin) !== "trial") return;
        if (isGuest()) { try { localStorage.removeItem(D.GUEST_KEY); } catch (e) { /* ignore */ } }
        root.style.visibility = "hidden"; toLogin(); return;
    }

    // Hide the page until the API confirms the token (a deleted, disabled or logged-out account fails here)
    root.style.visibility = "hidden";
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);

    var wikiUrl = D.sites.wiki + "/?avatar=required";

    fetch(API + "/me", { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
            clearTimeout(timer);
            if (res.status === 401 || res.status === 403) { clearToken(); toLogin("expired"); return; }
            if (needsAvatar && res.ok) {
                return res.json().then(function (data) {
                    if (!data || !data.avatar) { location.replace(wikiUrl); return; }   // no avatar: pick one on the Wiki first
                    reveal();
                }).catch(reveal);
            }
            reveal();   // ok, or the server is having a problem: let the page show its own error
        })
        .catch(function (e) { clearTimeout(timer); console.warn("gate: could not reach the API (CORS or network?)", e); reveal(); });
})();
