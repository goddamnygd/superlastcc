/* Background media shared by all four sites (one file, hosted by the hub).
   1) Login pages: plays a random background video (the <video id="bgVideo"> tag in login.html).
   2) Every page: loops the background music, with a small mute button. The mute choice and the song
      position are remembered, so the music carries on from page to page of the same site.
   Browsers block sound until the visitor clicks or taps once, so the music starts on the first
   click, tap or key press when it can't start by itself. */
(function () {
    "use strict";

    // ---- SETTINGS: shared by all four sites (the number of login videos per site is in sites.json) ----
    // MEDIA_BASE points at the `backgorund` folder of the PUBLIC GitHub repo through jsDelivr.
    var MEDIA_BASE = "https://cdn.jsdelivr.net/gh/goddamnygd/superlastcc@main/backgorund/";
    var VIDEOS = ["bg-1.mp4", "bg-2.mp4", "bg-3.mp4", "bg-4.mp4", "bg-5.mp4", "bg-6.mp4", "bg-7.mp4", "bg-8.mp4", "bg-9.mp4", "bg-10.mp4", "bg-11.mp4", "bg-12.mp4", "bg-13.mp4", "bg-14.mp4", "bg-15.mp4", "bg-16.mp4", "bg-17.mp4", "bg-18.mp4", "bg-19.mp4", "bg-20.mp4"];
    var MUSIC = "bg_music.mp3";
    var MUSIC_VOLUME = 0.35;   // 0 to 1
    // ---------------------------------------------------------------------------------------------

    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }

    // ===== login page video: plays a random clip, then fades into a different random one =====
    var video = document.getElementById("bgVideo");
    if (video && VIDEOS.length) {
        var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        var saveData = navigator.connection && navigator.connection.saveData;
        if (reduce || saveData) {
            video.remove();                       // plain dark background instead
        } else {
            var FADE_MS = 900;                    // fade in / out time
            var current = Number(get("bgLast"));
            var failures = 0, fadingOut = false;
            video.loop = false;                   // we pick the next clip ourselves
            video.removeAttribute("loop");
            video.muted = true;
            video.style.transition = "opacity " + FADE_MS + "ms ease";
            video.style.opacity = "0";

            var pickNext = function () {
                var i;
                do { i = Math.floor(Math.random() * VIDEOS.length); } while (VIDEOS.length > 1 && i === current);
                return i;
            };
            var playClip = function (i) {
                current = i; fadingOut = false;
                set("bgLast", String(i));
                video.src = MEDIA_BASE + VIDEOS[i];
                video.play().catch(function () { /* e.g. low-power mode: the dark background stays */ });
            };
            var fadeToNext = function () {
                if (fadingOut) return;
                fadingOut = true;
                video.style.opacity = "0";
                setTimeout(function () { playClip(pickNext()); }, FADE_MS);
            };

            video.addEventListener("playing", function () { failures = 0; video.style.opacity = ""; });   // fade in
            video.addEventListener("timeupdate", function () {                                              // start fading just before the end
                if (video.duration && video.duration - video.currentTime < FADE_MS / 1000 + 0.15) fadeToNext();
            });
            video.addEventListener("ended", fadeToNext);
            video.addEventListener("error", function () {                                                   // a clip failed: try another, but not forever
                if (++failures <= VIDEOS.length) playClip(pickNext());
            });

            playClip(pickNext());
        }
    }

    // ===== music (every page) =====
    var audio = new Audio(MEDIA_BASE + MUSIC);
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
    audio.preload = "auto";

    var muted = get("bgMusicMuted") === "1";
    // A refresh (F5 / reload button) restarts the song. Moving between pages keeps playing from where it was.
    var nav = (window.performance && performance.getEntriesByType) ? performance.getEntriesByType("navigation")[0] : null;
    var isReload = nav ? nav.type === "reload" : (window.performance && performance.navigation && performance.navigation.type === 1);
    if (isReload) set("bgMusicTime", "0");
    var saved = isReload ? 0 : parseFloat(get("bgMusicTime"));
    var restored = false;
    audio.addEventListener("loadedmetadata", function () {
        if (!restored && isFinite(saved) && saved > 0 && saved < audio.duration) { try { audio.currentTime = saved; } catch (e) { /* ignore */ } }
        restored = true;
    });

    // mute button
    var btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2500;width:38px;height:38px;border-radius:50%;" +
        "border:1px solid #751010;background:rgba(16,17,20,.85);color:#fff;font-size:17px;line-height:1;cursor:pointer;padding:0";
    function paint() {
        var playing = !muted && !audio.paused;
        btn.textContent = muted ? "🔇" : "🔊";
        btn.style.opacity = playing || muted ? "1" : ".7";
        btn.title = muted ? "Turn music on" : "Mute music";
        btn.setAttribute("aria-label", btn.title);
    }
    btn.addEventListener("click", function (e) {
        e.stopPropagation();
        muted = !muted;
        set("bgMusicMuted", muted ? "1" : "0");
        if (muted) audio.pause(); else tryPlay();
        paint();
    });

    var waiting = false;
    function tryPlay() {
        if (muted) return;
        var p = audio.play();
        if (p && p.catch) p.catch(waitForGesture);
    }
    function waitForGesture() {
        if (waiting) return;
        waiting = true;
        var start = function () {
            waiting = false;
            ["pointerdown", "keydown", "touchstart"].forEach(function (n) { document.removeEventListener(n, start, true); });
            tryPlay();
            paint();
        };
        ["pointerdown", "keydown", "touchstart"].forEach(function (n) { document.addEventListener(n, start, true); });
    }

    // remember where the song is, so the next page continues from there
    function savePosition() { if (!audio.paused) set("bgMusicTime", String(audio.currentTime)); }
    setInterval(savePosition, 1000);
    window.addEventListener("pagehide", savePosition);
    audio.addEventListener("play", paint);
    audio.addEventListener("pause", paint);

    function init() { document.body.appendChild(btn); paint(); tryPlay(); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
