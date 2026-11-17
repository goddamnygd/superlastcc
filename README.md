# Dead by Daylight Character Directory

A cloud-based project with one REST API and three websites that all use it.

| Part | Folder | What it does |
|---|---|---|
| API | `api/` | FastAPI app on Vercel. Talks to a Supabase (PostgreSQL) database. |
| Wiki | `web1-wiki/` | Browse, search and filter all Survivors and Killers. Players equip their avatar here. |
| Minigame | `web2-minigame/` | Guess the character from a description, perks or a zoomed image. |
| DBDle | `web3-dbdle/` | Wordle-style guessing game with comparison clues. |
| Database | `sql/` | Tables, functions and security rules for Supabase. |

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
4. Register an account on any of the sites, then make yourself admin in the SQL Editor:
   `update public.users set role_id = 2 where username = 'your_username';`
5. Deploy the three site folders. Each one already includes `auth.js`.

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
| POST / PATCH / DELETE | `/api/v1/characters...` | admin key **or** admin login | Same as before |

## Security notes

- Passwords are hashed with bcrypt. Only the hash is stored and it is never sent back.
- Login tokens are JWTs. Each token carries the user's `token_version`, and the API checks it against the database on every request, so "log out everywhere", password changes and disabled accounts take effect immediately.
- 5 wrong passwords lock the account for 15 minutes. The counting is done in one atomic SQL function.
- The database refuses to remove or disable the last active admin (trigger `protect_last_admin`).
- Row-level security is on for every table, so the public Supabase key can read or write nothing. Only the API, using the service key, can.

## Known limitations

- **Wins are reported by the browser.** The games pick the answer on the client, so a technical user could call `/me/avatar/win` directly. The API limits this with a cooldown (`WIN_COOLDOWN_SECONDS`, default 10) but cannot fully prevent it. Real protection needs the server to pick the answer and check the guess.
- **The three sites are different domains**, so a login on one site is not shared with the others. The user logs in once per site.
- The read key `student-api-key-123` is visible in the frontend code. That is acceptable for a read-only key, but it is not a secret. The admin key and `JWT_SECRET` must never go in frontend code.
- Registration has no rate limit of its own. Vercel's firewall or rate limiting can be added.
