# Dead by Daylight Character Directory

A cloud-based project with one REST API and four websites that all use it.

| Part | Folder | What it does |
|---|---|---|
| API | `api/` | FastAPI app on Vercel. Talks to a Supabase (PostgreSQL) database. |
| Wiki | `web1-wiki/` | Browse, search and filter all Survivors and Killers. Players equip their avatar here. |
| Minigame | `web2-minigame/` | Guess the character from a description, perks or a zoomed image. |
| DBDle | `web3-dbdle/` | Wordle-style guessing game with comparison clues. |
| Trial | `web4-trial/` | Turn-based Escape (Survivor) and Hunt (Killer) game. |
| Shared files (hub) | `web1-wiki/shared/` | The ONE copy of the login page, login gate, auth, config and background media. The Wiki is the hub and hosts them for all four sites. |
| Database | `sql/` | Tables, functions and security rules for Supabase. |

## Look and effects (shared)

The design lives in the hub (`web1-wiki/shared/`), so all four sites share it and the login page stays as it was:

- `theme.css`: colors, fonts, header, buttons, pop-ups, marquee, reveal classes. Loaded by every site, **not** by `login.html`.
- `fx.js`: fog and embers, terror-radius cursor, generator scroll bar, flashlight (`.flashlight` elements), card tilt, count-up numbers. Games call `DBDFX.burst / flash / shake`. Everything is off for `prefers-reduced-motion`.

## Accounts

- **Normal user (`user`)**: can register, log in, equip **one** avatar, and read characters.
- **Admin (`admin`)**: everything a user can do, plus managing characters, changing other users' roles, disabling accounts, and reading the audit log.
- Anyone who registers is always a normal user. The first admin is promoted manually in the database (see the bottom of `sql/accounts.sql`).

### Equipped avatar and leveling

- A user can only have one equipped avatar. The database enforces this: `equipped_avatar.user_id` is the primary key, so a second row for the same user is impossible. Equipping another character replaces the current one.
- Every time the user **wins a round** in the Minigame or in DBDle, the equipped avatar goes up one level (and its win count goes up by one).
- Re-equipping the same character keeps its level. Equipping a different character starts that character at level 1.
- If the user is not logged in or has no avatar, the game still works, it just does not level anything.

## Setup order

1. In the Supabase SQL Editor run `sql/schema.sql`, then `sql/seed.sql`, then `sql/accounts.sql`.
   (If you used an older version of the account tables, run `sql/reset_accounts.sql` before `accounts.sql`.)
2. In Vercel, add these Environment Variables to the API project (see `api/.env.example`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `API_KEY`, `ADMIN_API_KEY`, `JWT_SECRET`.
   `JWT_SECRET` must be a long random string. Without it, login returns a 503.
3. Redeploy the API (new packages in `requirements.txt`: `pyjwt`, `bcrypt`).
4. Run `sql/perks_powers.sql` (after `seed.sql`). It creates the perk and power tables, see **Perks and powers** below.
5. Register an account on any of the sites, then make yourself admin in the SQL Editor:
   `update public.users set role_id = 2 where username = 'your_username';`
6. Deploy the four site folders, one Vercel project each (Root Directory = the site's folder), on the addresses listed in `web1-wiki/shared/config.js`.
   Only the **Wiki (the hub)** project needs Environment Variables (they stay on the server, nothing is in any site's files):
   `BACKEND_URL` = the API's address, e.g. `https://superlastcc.vercel.app` and `API_KEY` = the same read key as the API project.
   See `api/.env.example` and `web1-wiki/.env.example`. The other three sites need none.

## One login for all four sites (the hub)

The sites keep their own addresses, so a browser cannot share storage between them. Instead the **Wiki is the hub**:
it hosts the only login page and the only copy of the shared files, and the other sites load them from it.

```
web1-wiki/                       <- the hub
  shared/  config.js  gate.js  login.html  login.js  login.css  auth.js  bgmedia.js   <- the ONE copy of everything identical
  api/v1/[...path].js            <- the API proxy for all four sites
web2-minigame/  web3-dbdle/  web4-trial/    <- only their own pages; they load /shared/... from the hub's address
```

How a visit works:
1. A visitor opens any site with no login. `gate.js` sends them to `<hub>/shared/login.html?return=<the page they wanted>`.
2. They log in once (or choose guest). The hub sends them back to that page with the token in the URL `#fragment` (never sent to a server). `config.js` saves it and cleans the address bar.
3. They open another site. It has no token yet, so it asks the hub. The hub already knows them and sends them straight back with the token: **no typing**, just a quick redirect.

Rules and limits:
- `shared/config.js` is the one list of the four site addresses. Tokens are only ever sent to those addresses, and the hub refuses any other `return=`. If an address changes, change it there (and in the sites' navigation links).
- The login page looks like the site the visitor came from, and the Trial hides "continue as guest" because it needs an account. Texts: `BRANDS` in `shared/login.js`.
- **Log out** clears that site and the hub (so the hub does not sign them straight back in). Other sites keep their own token until it expires (24 h) or the visitor presses **Log out everywhere**, which invalidates every token.
- An expired or revoked token sends the visitor back to the hub's login form.
- If the hub is down, nobody can log in and the shared scripts do not load.

## Hidden API key and address

The browser no longer knows the API key or the API's address. Every site calls the **hub's** address
(`<hub>/api/v1/...`, see `DBD.api` in `shared/config.js`), and a small Vercel function on the hub (`web1-wiki/api/v1/[...path].js`) forwards the request to the real API:

- It reads `BACKEND_URL` and `API_KEY` from the hub project's Environment Variables and adds the `x-api-key` header itself, only for `GET /characters...`.
- It only passes on `Authorization`, `Content-Type` and `Accept`, so a visitor cannot send their own `x-api-key` or `x-admin-key` through it.
- It only forwards paths that start with `/api/v1/` on the `BACKEND_URL` host.
- It answers CORS only for the four site addresses in `shared/config.js` (add more with the optional `ALLOWED_ORIGINS` variable).
- The key now exists in one place only: the hub's Environment Variables.

## Perks and powers (database)

What every perk and Killer power does in the Trial games is now data, not code (`sql/perks_powers.sql`):

| Table | Holds |
|---|---|
| `perk_kinds` | the simple one-use moves (per side) and their help text. `default_slot` = the move a new perk gets in slot 1-3 |
| `perks` | every perk name, its side (`survivor` / `killer`) and the move it uses |
| `power_kinds` | each Killer power mechanic: cooldown in turns, attack boost, help text. `is_default` = used for unknown powers |
| `powers` | every Killer power name and its mechanic |

- Adding a Character with a new perk or power name registers it automatically (database trigger), with the default move for its slot, so the games never break.
- The API (`api/_catalog.py`) reads the tables and caches them for 60 seconds. The lists inside `_trial.py` / `_hunt.py` are only a fallback if the tables are empty or the database is unreachable.
- A *new kind* of move still needs code in the game engine. The database picks which existing move a perk or power uses and tunes the numbers.
- Admin: `PATCH /api/v1/perks/{id}` or `/powers/{id}` with `{"kind": "heal"}`, and `PATCH /api/v1/power-kinds/{kind}` with `cooldown`, `boost` and/or `help`.

## Endpoints

Read endpoints use the `x-api-key` header. Account endpoints use `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register` | public | Create a normal account, returns a token |
| POST | `/api/v1/auth/login` | public | Log in with username or email |
| POST | `/api/v1/auth/change-password` | logged in | Change password, logs out other devices |
| POST | `/api/v1/auth/logout-all` | logged in | Invalidate every token of the account |
| GET | `/api/v1/me` | logged in | Own profile and avatar |
| PUT / DELETE | `/api/v1/me/avatar` | logged in | Equip (replace) or remove the avatar |
| POST | `/api/v1/me/avatar/win` | logged in | Called by the games, +1 level |
| GET | `/api/v1/admin/users` | admin | List accounts |
| PATCH | `/api/v1/admin/users/{id}` | admin | Change `role_id` or `is_active` |
| GET | `/api/v1/admin/audit-log` | admin | Login and admin events |
| GET | `/api/v1/characters`, `/search`, `/{id}` | read key | Same as before |
| GET | `/api/v1/perks`, `/powers`, `/perk-kinds`, `/power-kinds` | read key | Perks and powers and what they do (`perks` filters: `side`, `kind`, `q`) |
| PATCH | `/api/v1/perks/{id}`, `/powers/{id}`, `/power-kinds/{kind}` | admin key **or** admin login | Change what a perk or power does |
| POST / PATCH / DELETE | `/api/v1/characters...` | admin key **or** admin login | Same as before |

## Security notes

- Passwords are hashed with bcrypt. Only the hash is stored and it is never sent back.
- Login tokens are JWTs. Each token carries the user's `token_version`, and the API checks it against the database on every request, so "log out everywhere", password changes and disabled accounts take effect immediately.
- 5 wrong passwords lock the account for 15 minutes. The counting is done in one atomic SQL function.
- The database refuses to remove or disable the last active admin (trigger `protect_last_admin`).
- Row-level security is on for every table, so the public Supabase key can read or write nothing. Only the API, using the service key, can.

## Known limitations

- **Wins are reported by the browser.** The games pick the answer on the client, so a technical user could call `/me/avatar/win` directly. The API limits this with a cooldown (`WIN_COOLDOWN_SECONDS`, default 10) but cannot fully prevent it. Real protection needs the server to pick the answer and check the guess.
- The read key is no longer in the frontend. It lives in each site's Environment Variables and the proxy adds it. It is still a *read-only* key: anyone can read characters through a site's proxy, which is public data anyway. The old key was in earlier versions of the code and git history, so **change `API_KEY` on the API project and on the hub project** once this version is deployed. The admin key and `JWT_SECRET` must never go in frontend code.
- Because requests now come from the hub's server, the API's audit log records that server's address instead of the visitor's. Accounts are locked per account, so lockout is not affected.
- Registration has no rate limit of its own. Vercel's firewall or rate limiting can be added.
