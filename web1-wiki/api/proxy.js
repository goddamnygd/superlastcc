/* Server-side proxy. vercel.json sends every /api/v1/* request to this function (as /api/proxy?p=<path>).
   The browser only ever talks to the hub ("<hub>/api/v1/..."). This function forwards the request to
   the real API and adds the read key there, so neither the API address nor the key is in any
   file the visitor can download.

   This is the HUB's proxy: all four sites call it (the other three from their own addresses, which is
   why it answers CORS for the addresses listed in shared/config.js). The key therefore only has to
   exist in ONE place.

   Set these two Environment Variables on the hub (Wiki) project (never in the code):
     BACKEND_URL   the API's address, e.g. https://superlastcc.vercel.app   (no trailing slash needed)
     API_KEY       the same read key the API project uses

   Only the headers listed below are passed on, so a visitor cannot send their own x-api-key or
   x-admin-key through this proxy. */
"use strict";

// Which sites may call this proxy from a browser: the list in shared/config.js (extra ones: ALLOWED_ORIGINS=a,b)
let ALLOWED = [];
try { ALLOWED = Object.values(require("../../shared/config.js").SITES); } catch (e) { /* env only */ }
ALLOWED = ALLOWED.concat((process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean));

function cors(req, res) {
    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    if (origin && ALLOWED.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
    }
}

const PASS_HEADERS = ["authorization", "content-type", "accept", "user-agent"];
const MAX_BODY = 64 * 1024;                 // none of our requests are larger than this

module.exports = async function handler(req, res) {
    cors(req, res);
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }   // the browser's permission check before a cross-site call
    const backend = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
    if (!backend) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ detail: "The site is not configured (BACKEND_URL is missing)." }));
    }

    // Only /api/v1/... is forwarded, and it must stay on the backend host
    let target;
    try {
        // vercel.json rewrites /api/v1/<path> to /api/proxy?p=<path>; a request that arrives as /api/v1/<path> directly also works
        const incoming = new URL(req.url, "http://local");
        let path = incoming.pathname;
        if (incoming.searchParams.has("p")) {
            path = "/api/v1/" + incoming.searchParams.get("p");
            incoming.searchParams.delete("p");
        }
        target = new URL(path + incoming.search, backend + "/");
        const base = new URL(backend + "/");
        if (target.origin !== base.origin || !target.pathname.startsWith("/api/v1/") || target.pathname.includes("..")) throw new Error("bad path");
    } catch (e) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ detail: "Bad request." }));
    }

    const headers = {};
    for (const name of PASS_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
    // The read key is added here, and only for reading characters
    if (req.method === "GET" && /^\/api\/v1\/characters(\/|$)/.test(target.pathname) && process.env.API_KEY) {
        headers["x-api-key"] = process.env.API_KEY;
    }
    // Tell the API which visitor this is (Vercel sets x-forwarded-for from the real connection)
    const visitor = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (visitor) headers["x-forwarded-for"] = visitor;

    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BODY) {
                res.statusCode = 413;
                res.setHeader("Content-Type", "application/json");
                return res.end(JSON.stringify({ detail: "Request too large." }));
            }
            chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
    }

    try {
        const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
        res.statusCode = upstream.status;
        const type = upstream.headers.get("content-type");
        if (type) res.setHeader("Content-Type", type);
        res.setHeader("Cache-Control", "no-store");
        res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ detail: "Cannot reach the API." }));
    }
};

module.exports.config = { api: { bodyParser: false } };
