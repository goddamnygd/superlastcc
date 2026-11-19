(function () {
    "use strict";

    // ---- SETTINGS: the only part you edit -------------------------------------------------------
    // Where the files live. This points at the `backgorund` folder of your PUBLIC GitHub repo through
    // jsDelivr. Replace YOUR-GITHUB-USER / YOUR-REPO (and the branch, if it is not "main").
    var MEDIA_BASE = "https://cdn.jsdelivr.net/gh/goddamnygd/superlastcc@main/backgorund/";
    var VIDEOS = ["bg-1.mp4", "bg-2.mp4", "bg-3.mp4", "bg-4.mp4", "bg-5.mp4"];
    var MUSIC = "bg_music.mp3";
    var MUSIC_VOLUME = 0.35;   // 0 to 1
    // ---------------------------------------------------------------------------------------------

    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }

    // ===== login page video =====
    var video = document.getElementById("bgVideo");
    if (video && VIDEOS.length) {
        var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        var saveData = navigator.connection && navigator.connection.saveData;
        if (reduce || saveData) {
            video.remove();                       // plain dark background instead
        } else {
            var last = Number(get("bgLast"));
            var i;
            do { i = Math.floor(Math.random() * VIDEOS.length); } while (VIDEOS.length > 1 && i === last);
            set("bgLast", String(i));
            video.muted = true;
            video.src = MEDIA_BASE + VIDEOS[i];
            video.play().catch(function () { /* e.g. low-power mode: the dark background stays */ });
        }
    }

    // ===== music (every page) =====
    var audio = new Audio(MEDIA_BASE + MUSIC);
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
    audio.preload = "auto";

    var muted = get("bgMusicMuted") === "1";
    var saved = parseFloat(get("bgMusicTime"));
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
