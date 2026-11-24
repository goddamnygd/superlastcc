/* Shared effects for the Wiki, Minigame, DBDle and Trial (hub-hosted, NOT used by the login page).
   - drifting fog + rising embers + a faint lamp that follows the pointer (one canvas)
   - terror-radius cursor, claw scratch on click (mouse only)
   - generator-repair scroll bar, header that tightens on scroll, sliding site switcher
   - flashlight: every .flashlight element gets --fx/--fy (follows the pointer, wanders by itself otherwise)
   - tilt + spotlight on cards, scroll reveal, count-up numbers, marquee duplication, first-visit intro
   - window.DBDFX = { burst, flash, shake, count } for the games.
   Everything is skipped or frozen for prefers-reduced-motion. */
(function () {
    "use strict";
    if (window.DBDFX) return;
    var doc = document, root = doc.documentElement;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;

    function $(s, c) { return (c || doc).querySelector(s); }
    function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
    function mk(tag, attrs, html) {
        var n = doc.createElement(tag);
        for (var k in (attrs || {})) n.setAttribute(k, attrs[k]);
        if (html) n.innerHTML = html;
        return n;
    }
    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

    var API = window.DBDFX = {};
    var burstList = [];
    var W = 0, H = 0, dpr = 1, cv, ctx, sprite;
    var px = -999, py = -999, rx = -999, ry = -999, target = null, lastCard = null, moved = false;

    function init() {
        if (!doc.body) return;
        if (fine) root.classList.add("fx-fine");
        marquees(); gens(); header(); switchers(); reveal(); counters(); intro();
        if (!reduce) { fog(); bc = mk("canvas", { id: "fx-burst", "aria-hidden": "true" }); doc.body.append(bc); bctx = bc.getContext("2d"); resize(); }
        pointer();
        requestAnimationFrame(loop);
    }

    /* ---------- fog / embers canvas ---------- */
    var blobs = [], embers = [];
    function fog() {
        cv = mk("canvas", { id: "fx-fog", "aria-hidden": "true" });
        doc.body.insertBefore(cv, doc.body.firstChild);
        ctx = cv.getContext("2d");
        sprite = doc.createElement("canvas"); sprite.width = sprite.height = 256;
        var sc = sprite.getContext("2d"), g = sc.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
        sc.fillStyle = g; sc.fillRect(0, 0, 256, 256);
        resize(); window.addEventListener("resize", resize);
        for (var i = 0; i < 7; i++) blobs.push({ x: Math.random(), y: Math.random(), s: 520 + Math.random() * 520, sp: .02 + Math.random() * .04, ph: Math.random() * 6.28, a: .05 + Math.random() * .05, red: i === 2 || i === 5 });
        var n = W < 700 ? 22 : 46;
        for (i = 0; i < n; i++) embers.push(ember(true));
    }
    function resize() {
        W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 1.5);
        if (!cv) return;
        cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (bc) { bc.width = W * dpr; bc.height = H * dpr; bctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    }
    function ember(init) {
        return { x: Math.random() * W, y: init ? Math.random() * H : H + 10, r: .6 + Math.random() * 1.8, vy: .15 + Math.random() * .5, sw: Math.random() * 6.28, sa: .2 + Math.random() * .6, a: .25 + Math.random() * .6, hot: Math.random() < .35 };
    }
    function tintBlob(b, t) {
        var x = (b.x * W) + Math.sin(t * b.sp + b.ph) * 160, y = (b.y * H) + Math.cos(t * b.sp * 1.3 + b.ph) * 110;
        ctx.globalAlpha = b.a * (b.red ? .8 + .4 * Math.sin(t * 1.5) : 1);
        ctx.drawImage(b.red ? tinted("r") : tinted("c"), x - b.s / 2, y - b.s / 2, b.s, b.s);
    }
    var tints = {};
    function tinted(k) {
        if (tints[k]) return tints[k];
        var c = doc.createElement("canvas"); c.width = c.height = 256;
        var x = c.getContext("2d"); x.drawImage(sprite, 0, 0);
        x.globalCompositeOperation = "source-in";
        x.fillStyle = k === "r" ? "#e0192b" : "#9fc3cc"; x.fillRect(0, 0, 256, 256);
        return (tints[k] = c);
    }
    function drawFog(t, dt) {
        ctx.clearRect(0, 0, W, H);
        blobs.forEach(function (b) { tintBlob(b, t); });
        ctx.globalAlpha = 1;
        if (fine && px > -900) {                               // lamp that follows the pointer
            var g = ctx.createRadialGradient(rx, ry, 0, rx, ry, 340);
            g.addColorStop(0, "rgba(255,198,107,.10)"); g.addColorStop(1, "rgba(255,198,107,0)");
            ctx.fillStyle = g; ctx.fillRect(rx - 340, ry - 340, 680, 680);
        }
        embers.forEach(function (e, i) {
            e.y -= e.vy * dt * 60; e.sw += .02;
            e.x += Math.sin(e.sw) * e.sa;
            if (e.y < -10) embers[i] = ember(false);
            var tw = .6 + .4 * Math.sin(t * 3 + i);
            ctx.fillStyle = e.hot ? "rgba(255,120,70," + (e.a * tw * .35) + ")" : "rgba(255,198,107," + (e.a * tw * .3) + ")";
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 3, 0, 6.28); ctx.fill();
            ctx.fillStyle = e.hot ? "rgba(255,150,90," + (e.a * tw) + ")" : "rgba(255,226,170," + (e.a * tw) + ")";
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.28); ctx.fill();
        });
    }

    var bc, bctx;
    function drawBurst(dt) {
        if (!bctx) return;
        if (!burstList.length) { if (bc._dirty) { bctx.clearRect(0, 0, W, H); bc._dirty = false; } return; }
        bctx.clearRect(0, 0, W, H); bc._dirty = true;
        for (var i = burstList.length - 1; i >= 0; i--) {
            var p = burstList[i];
            p.life -= dt; if (p.life <= 0) { burstList.splice(i, 1); continue; }
            p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
            bctx.fillStyle = "rgba(" + p.c + "," + clamp(p.life / p.max, 0, 1) + ")";
            bctx.beginPath(); bctx.arc(p.x, p.y, p.r, 0, 6.28); bctx.fill();
        }
    }

    /* ---------- pointer: cursor, claw, cards ---------- */
    var ring, dot;
    var SPOT = ".agent-card,.mode-card,.about-grid article,.gauge,.avatar-card,.killer-card,.survivor,.perk-chip,.stat,.hero-stat,.attempt-card,.turn-box";
    var TILT = ".agent-card,.mode-card,.about-grid article";
    var HOVER = "a,button,input,select,textarea,label,[role=button],.agent-card,.mode-card";
    function pointer() {
        doc.addEventListener("pointermove", function (e) {
            if (e.pointerType === "touch") return;
            px = e.clientX; py = e.clientY; moved = true;
            target = e.target.closest ? e.target.closest(SPOT) : null;
            if (fine && !reduce) {
                root.classList.add("fx-on");
                root.classList.toggle("fx-hover", !!(e.target.closest && e.target.closest(HOVER)));
            }
        }, { passive: true });
        if (!fine || reduce) return;
        ring = mk("div", { id: "fx-ring" }); dot = mk("div", { id: "fx-dot" });
        doc.body.append(ring, dot);
        doc.addEventListener("pointerdown", function () { root.classList.add("fx-down"); });
        doc.addEventListener("pointerup", function () { root.classList.remove("fx-down"); });
        doc.addEventListener("click", function (e) { claw(e.clientX, e.clientY); });
        doc.documentElement.addEventListener("mouseleave", function () { root.classList.remove("fx-on"); });
    }
    function claw(x, y) {
        var s = mk("svg", { "class": "fx-claw", viewBox: "0 0 90 90", style: "left:" + x + "px;top:" + y + "px" },
            '<path d="M22 8 L36 82"/><path d="M42 4 L56 86"/><path d="M62 8 L76 80"/>');
        doc.body.append(s); setTimeout(function () { s.remove(); }, 800);
    }

    /* ---------- main loop ---------- */
    var last = 0;
    function loop(ts) {
        var t = ts / 1000, dt = Math.min(.05, last ? t - last : .016); last = t;
        if (!doc.hidden) {
            if (px > -900) { rx += (px - rx) * .16; ry += (py - ry) * .16; if (rx < -900) { rx = px; ry = py; } }
            if (ring) {
                ring.style.transform = "translate3d(" + rx + "px," + ry + "px,0)";
                dot.style.transform = "translate3d(" + px + "px," + py + "px,0)";
            }
            if (ctx && !reduce) { drawFog(t, dt); drawBurst(dt); }
            cards(); lights(t);
        }
        requestAnimationFrame(loop);
    }
    function cards() {
        if (lastCard && lastCard !== target) {
            lastCard.style.removeProperty("--rx"); lastCard.style.removeProperty("--ry");
            lastCard = null;
        }
        if (!target || !moved) return;
        var r = target.getBoundingClientRect();
        var x = px - r.left, y = py - r.top;
        target.style.setProperty("--mx", x + "px"); target.style.setProperty("--my", y + "px");
        if (!reduce && target.matches(TILT)) {
            target.style.setProperty("--ry", ((x / r.width - .5) * 9).toFixed(2) + "deg");
            target.style.setProperty("--rx", ((.5 - y / r.height) * 9).toFixed(2) + "deg");
            lastCard = target;
        }
        moved = false;
    }
    var lightEls = [];
    function lights(t) {
        if (!lightEls.length) lightEls = $$(".flashlight");
        lightEls.forEach(function (el, i) {
            var r = el.getBoundingClientRect();
            if (r.bottom < 0 || r.top > innerHeight) return;
            var inside = fine && px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
            var tx = inside ? px - r.left : r.width * (.5 + .36 * Math.sin(t * .35 + i * 2));
            var ty = inside ? py - r.top : r.height * (.5 + .3 * Math.sin(t * .5 + 1.3 + i));
            el._fx = el._fx == null ? tx : el._fx + (tx - el._fx) * (inside ? .22 : .04);
            el._fy = el._fy == null ? ty : el._fy + (ty - el._fy) * (inside ? .22 : .04);
            el.style.setProperty("--fx", el._fx.toFixed(1) + "px");
            el.style.setProperty("--fy", el._fy.toFixed(1) + "px");
        });
    }

    /* ---------- header, scroll bar, switcher ---------- */
    var gensEl;
    function gens() {
        gensEl = mk("div", { id: "fx-gens", "aria-hidden": "true" }, "<i><b></b></i><i><b></b></i><i><b></b></i>");
        doc.body.append(gensEl);
        window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    }
    function onScroll() {
        var max = root.scrollHeight - innerHeight, p = max > 0 ? clamp(scrollY / max, 0, 1) : 0;
        $$("i", gensEl).forEach(function (seg, i) {
            var v = clamp(p * 3 - i, 0, 1);
            seg.firstChild.style.setProperty("--p", (v * 100).toFixed(1) + "%");
            seg.classList.toggle("done", v >= 1);
        });
        var tb = $(".topbar"); if (tb) tb.classList.toggle("scrolled", scrollY > 24);
    }
    function header() { /* scrolled class handled in onScroll */ }
    function switchers() {
        $$(".site-switcher").forEach(function (sw) {
            var glow = mk("i", { "class": "switch-glow" }); sw.insertBefore(glow, sw.firstChild);
            sw.classList.add("has-glow");
            var links = $$(".site-switch-link", sw);
            function active() { return $(".site-switch-link.active", sw) || links[0]; }
            function to(a) { if (!a || !a.offsetWidth) return; glow.style.width = a.offsetWidth + "px"; glow.style.transform = "translateX(" + a.offsetLeft + "px)"; }
            function place() { to(active()); sw.classList.add("ready"); }
            links.forEach(function (a) { a.addEventListener("mouseenter", function () { to(a); }); });
            sw.addEventListener("mouseleave", place);
            window.addEventListener("resize", place); window.addEventListener("load", place);
            if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(place);
            requestAnimationFrame(place);
        });
    }

    /* ---------- reveal, counters, marquee, intro ---------- */
    function reveal() {
        if (reduce || !window.IntersectionObserver) return;
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
        }, { threshold: .12, rootMargin: "0px 0px -6% 0px" });
        $$(".section-heading,.about-grid article,.mode-card,.marquee,.game-panel").forEach(function (n) {
            if (n.getBoundingClientRect().top < innerHeight * .92) return;
            var sib = n.parentNode ? Array.prototype.indexOf.call(n.parentNode.children, n) : 0;
            n.style.setProperty("--d", Math.min(sib, 5) * 90 + "ms");
            n.classList.add(n.matches(".section-heading") ? "rv-wipe" : "rv");
            io.observe(n);
        });
    }
    function counters() {
        var els = $$("[data-count]"); if (!els.length) return;
        if (!window.IntersectionObserver || reduce) { els.forEach(function (e) { API.count(e, +e.dataset.count); }); return; }
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) { if (e.isIntersecting) { API.count(e.target, +e.target.dataset.count); io.unobserve(e.target); } });
        }, { threshold: .4 });
        els.forEach(function (e) { io.observe(e); });
    }
    API.count = function (el, to) {
        var pad = +(el.dataset.pad || 0), from = 0, t0 = performance.now(), dur = reduce ? 1 : 1100;
        function fmt(v) { v = Math.round(v); var s = String(v); while (s.length < pad) s = "0" + s; return s; }
        (function step(now) {
            var k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt(from + (to - from) * e);
            if (k < 1) requestAnimationFrame(step);
        })(t0);
    };
    function marquees() {
        $$(".marquee-track").forEach(function (t) { t.innerHTML += t.innerHTML; });
    }
    function intro() {
        if (reduce) return;
        try { if (sessionStorage.getItem("fxIntro")) return; sessionStorage.setItem("fxIntro", "1"); } catch (e) { return; }
        var n = mk("div", { id: "fx-intro", "aria-hidden": "true" },
            '<svg viewBox="0 0 760 300"><path d="M120 10 L240 290"/><path d="M360 0 L480 300"/><path d="M590 10 L700 290"/></svg>' +
            '<div class="t">DEAD BAI<em>DAYLIGHT</em></div>');
        doc.body.append(n); setTimeout(function () { n.remove(); }, 1500);
    }

    /* ---------- API for the games ---------- */
    API.burst = function (a, b, opts) {
        var x = a, y = b;
        if (a && a.getBoundingClientRect) { var r = a.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; opts = b; }
        if (x == null) { x = innerWidth / 2; y = innerHeight / 2; }
        opts = opts || {};
        if (reduce) return;
        if (!ctx) return;
        var c = opts.blood ? "224,25,43" : "255,198,107", n = opts.count || 44;
        for (var i = 0; i < n; i++) {
            var an = Math.random() * 6.28, sp = 90 + Math.random() * 380;
            burstList.push({ x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 160, r: 1.2 + Math.random() * 2.6, life: .8 + Math.random() * .9, max: 1.5, c: c });
        }
    };
    API.flash = function (kind) {
        var f = $("#fx-flash") || doc.body.appendChild(mk("div", { id: "fx-flash" }));
        f.style.setProperty("--c", kind === "gold" ? "rgba(255,198,107,.5)" : "rgba(224,25,43,.6)");
        f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
    };
    API.shake = function (el) {
        if (!el || reduce) return;
        el.classList.remove("fx-shake"); void el.offsetWidth; el.classList.add("fx-shake");
        setTimeout(function () { el.classList.remove("fx-shake"); }, 560);
    };

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init); else init();
})();
