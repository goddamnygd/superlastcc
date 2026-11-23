/* The ONE place that knows the four site addresses. Hosted by the hub (the Wiki) and loaded FIRST
   by every page of every site:  <script src="https://<hub>/shared/config.js"></script>

   - The hub is the Wiki. It owns the login page, the shared scripts and the API proxy.
   - A visitor with no login on any site is sent to the hub's login page, and after logging in they
     are sent back to the page they wanted. The login token travels back in the URL "#fragment"
     (never sent to a server), and this file saves it and removes it from the address bar at once.
   - Tokens are only ever sent to the addresses listed here, so keep this list exact.
   - The hub's proxy (api/proxy.js) reads this same list for its CORS allow-list. */
(function (root) {
    "use strict";
    var SITES = {
        wiki:     "https://superlastcc-web1-wiki.vercel.app",
        minigame: "https://superlastcc-web2-minigame.vercel.app",
        dbdle:    "https://superlastcc-web3-dbdle.vercel.app",
        trial:    "https://superlastcc-web4-trial.vercel.app"
    };
    var HUB = SITES.wiki;

    if (typeof module !== "undefined" && module.exports) { module.exports = { SITES: SITES, HUB: HUB }; return; }   // used by the proxy (Node)

    var TOKEN_KEY = "dbd_token", GUEST_KEY = "dbd_guest";
    var DBD = root.DBD = { sites: SITES, hub: HUB, api: HUB + "/api/v1", TOKEN_KEY: TOKEN_KEY, GUEST_KEY: GUEST_KEY };

    // "wiki" / "minigame" / ... for an address, or null if it is not one of ours
    DBD.siteKey = function (origin) {
        for (var k in SITES) if (SITES[k] === origin) return k;
        return null;
    };

    // Address of the hub's login page. By default the visitor comes back to the page they are on now.
    //   opts.reason  "expired" shows a notice      opts.silent  bounce straight back if the hub already knows the visitor
    //   opts.logout  clears the hub's login too    opts.ret     another page to come back to
    DBD.loginUrl = function (opts) {
        opts = opts || {};
        var ret = opts.ret || (location.origin + location.pathname + location.search);
        return HUB + "/shared/login.html?return=" + encodeURIComponent(ret) +
            (opts.reason ? "&reason=" + opts.reason : "") + (opts.silent ? "&silent=1" : "") + (opts.logout ? "&logout=1" : "");
    };

    // Come back from the hub: #dbd_token=... (logged in) or #dbd_guest=1 (guest). Save it, then clean the address bar.
    (function takeHandoff() {
        var m = /^#(dbd_token|dbd_guest)=([^&]*)$/.exec(location.hash);
        if (!m) return;
        try {
            if (m[1] === "dbd_token") { localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[2])); localStorage.removeItem(GUEST_KEY); }
            else if (m[2] === "1") localStorage.setItem(GUEST_KEY, "1");
        } catch (e) { /* storage blocked: the gate will send the visitor back to the hub */ }
        try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ }
    })();
})(typeof window !== "undefined" ? window : this);
