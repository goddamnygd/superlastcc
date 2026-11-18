/* Login gate. Loaded in the <head> of every page, so the page stays hidden until the visitor
   is confirmed to be logged in. No valid login = redirect to login.html.
   NOTE: this guards the pages. The API's read key is still public (see README). */
(function () {
    "use strict";
    var API = "https://superlastcc.vercel.app/api/v1";
    var TOKEN_KEY = "dbd_token";
    var root = document.documentElement;

    function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
    function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }
    function reveal() { root.style.visibility = ""; }

    function toLogin(reason) {
        var file = location.pathname.split("/").pop() || "index.html";
        var next = file + location.search;
        var url = "login.html?next=" + encodeURIComponent(next) + (reason ? "&reason=" + reason : "");
        location.replace(url);
    }

    var token = getToken();
    if (!token) { root.style.visibility = "hidden"; toLogin(); return; }

    // Hide the page until the API confirms the token (a deleted, disabled or logged-out account fails here)
    root.style.visibility = "hidden";
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);

    fetch(API + "/me", { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
            clearTimeout(timer);
            if (res.status === 401 || res.status === 403) { clearToken(); toLogin("expired"); return; }
            reveal();   // ok, or the server is having a problem: let the page show its own error
        })
        .catch(function () { clearTimeout(timer); reveal(); });
})();
