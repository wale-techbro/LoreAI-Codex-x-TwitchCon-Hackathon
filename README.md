# LORE

LORE is a living memory for Twitch communities. It captures meaningful chat moments, recurring jokes, and community events as reviewable lore, then answers questions with evidence from a creator’s approved history.

## What it does

- Connects each Twitch creator through Twitch OAuth Authorization Code Grant.
- Saves `channel.chat.message` events to a creator’s channel in Supabase.
- Turns `!lore <moment>` and repeated chat phrases into proposed lore entries.
- Lets the connected creator approve or reject private proposals.
- Answers questions using only relevant approved lore and returns source entries.
- Responds to `!asklore <question>` in chat with a grounded answer, or `I don't know that one yet. Maybe someone should add it with !lore!` when the channel has no matching evidence.
- Provides a public OBS browser overlay at `/overlay/<channel-login>`; it can retrieve only lore approved for that channel.
- Includes a local fictional demo community so the UI can be explored without Twitch or Supabase.

## Architecture

```text
Creator browser --Twitch OAuth--> Next.js web service
                                      | encrypted Twitch token pair
                                      v
Twitch EventSub --> Render worker --> Supabase
                         |             channels / chat_messages / lore_entries
                         |             creator_accounts / creator_sessions
                         |             asklore_requests
                         +--> approved channel lore --> Twitch chat reply

Viewer / OBS --> /overlay/<login> --> /api/ask --> approved lore for that channel
```

The web service owns OAuth callbacks, creator sessions, Lorebook APIs, public ask APIs, and the overlay. The worker polls connected creator accounts and keeps one EventSub WebSocket per creator. Twitch access and refresh tokens are encrypted with AES-256-GCM before storage in Supabase. The application uses server-side Supabase service credentials only; browser code receives neither tokens nor database credentials. Database queries and moderation updates are scoped to the signed-in creator’s channel. Public overlays can query a channel by login but see only approved lore.

## Technology

- TypeScript, Next.js App Router, React, Node.js 22.23.4, and pnpm
- Twitch OAuth Authorization Code Grant, EventSub WebSockets, and Send Chat Message API
- Supabase Postgres and server-only Supabase client
- Optional OpenAI Responses API; a grounded summary fallback works without it
- Render Web Service for the Next.js app and APIs; Render Background Worker for EventSub

## Prerequisites

- Node.js 22.23.4 and pnpm
- A Twitch Developer application
- A Supabase project
- An OpenAI API key for model-generated answers (optional)
- Render services for production. The smallest always-on Render Background Worker plan is paid; check the current [Render pricing](https://render.com/pricing).

## Local setup

```sh
pnpm install --frozen-lockfile
Copy-Item .env.example .env   # PowerShell; use cp .env.example .env on macOS/Linux
pnpm dev
```

The local demo uses `data/local.json` when Supabase is not configured. `pnpm seed` resets only that local demo store; it refuses to seed a configured Supabase project. Do not place secrets in client-side variables such as `NEXT_PUBLIC_*`.

### Environment variables

| Variable | Web service | Worker | Purpose |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Required | Required | Supabase project URL. Production fails clearly if it is missing. |
| `SUPABASE_SECRET_KEY` | Required | Required | Server-only Supabase secret key. Never expose it in browser code. |
| `TWITCH_CLIENT_ID` | Required | Required | Twitch Developer application ID. |
| `TWITCH_CLIENT_SECRET` | Required | Required | Server-only Twitch app secret used for OAuth code exchange and token refresh. |
| `TWITCH_REDIRECT_URI` | Required | Not used | Exact callback URL registered in the Twitch Developer Console, such as `https://<render-web-host>/api/auth/twitch/callback`. |
| `APP_ORIGIN` | Required | Not used | Canonical web-app origin used for OAuth callback redirects. Use the same origin as `TWITCH_REDIRECT_URI`; production must use HTTPS. |
| `TWITCH_TOKEN_ENCRYPTION_KEY` | Required | Required | A random 32-byte key encoded as 64 hexadecimal characters; encrypts stored Twitch access and refresh tokens. Keep the same key on both services and back it up securely. |
| `OPENAI_API_KEY` | Optional | Optional | Enables model-generated grounded answers in the app and `!asklore`. |
| `OPENAI_MODEL` | Optional | Optional | Optional model override; defaults to the model configured in the answer module. |

Set these values directly in your local `.env` or each Render service’s environment settings. `.env` is ignored by Git. For example, generate an encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; keep the output private and set the same value on the web and worker services.

## Supabase setup

Apply the migrations in order using the Supabase SQL Editor or your normal migration workflow:

1. `supabase/migrations/001_lore.sql` creates channels, chat messages, and lore entries.
2. `supabase/migrations/002_lore_proposal_idempotency.sql` creates the atomic `create_lore_proposal_once` RPC.
3. `supabase/migrations/003_multi_creator.sql` adds creator accounts and sessions, chat chatter IDs, `!asklore` idempotency/rate-limit storage, token lifecycle RPCs, and per-creator channel links.

Migration 003 backfills a creator account for each existing channel and links the channel in place. It does not delete or rewrite existing lore or chat rows. Those imported channel records have no OAuth token until their Twitch owner connects again through LORE.

RLS is enabled on the tables. The server uses `SUPABASE_SECRET_KEY`; never use it in client code. Production requires both Supabase variables and does not fall back to the ephemeral Render filesystem.

## Twitch application setup

1. Set `APP_ORIGIN` to the canonical web-app origin. Set `TWITCH_REDIRECT_URI` to that origin plus `/api/auth/twitch/callback`, then register that exact callback URL in the Twitch Developer Console.
2. Configure `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` on both the web service and worker.
3. The creator uses **Connect with Twitch** in LORE. The Authorization Code Grant requests `user:read:chat` and `user:write:chat`. Twitch’s callback state is checked before exchanging the code, and the returned token is validated for the correct app, identity, and scopes.
4. The app encrypts and stores the access/refresh token pair in Supabase. Twitch refresh-token rotation is persisted; disconnect revokes the Twitch token and preserves channel history and lore.
5. The worker uses the connected creator ID for both `broadcaster_user_id` and `user_id` in that creator’s chat EventSub condition. Each creator authorizes their own channel.

The browser login and consent step is manual because Twitch requires the creator to sign in and approve access. The worker does not send a test message during setup.

## Run the app and worker

Run the Next.js app in one terminal:

```sh
pnpm dev
```

Run the Twitch worker in another terminal after setting Supabase, Twitch app, and token-encryption variables:

```sh
pnpm worker
```

The worker stays connected while there are no creator accounts and begins listening after a creator completes OAuth. It uses the channel-specific Twitch token and saves all chat messages. `!lore <moment>` makes a proposal. `!asklore <question>` answers from approved lore and is limited to 20 requests per channel and 3 per chatter per rolling minute. Each Twitch message can trigger at most one `!asklore` response.

## Lorebook, APIs, and overlay

- `/` — local demo or signed-in creator Lorebook.
- `/api/auth/twitch` — starts OAuth; `/api/auth/twitch/callback` validates state and creates the server-side creator session.
- `DELETE /api/auth/twitch/disconnect` — revokes the current creator token and clears the session while preserving community history.
- `GET /api/lore` — returns lore only to its signed-in creator (or the local demo when using local storage).
- `PATCH /api/lore/:id` — approves or rejects lore only when the session owns the entry’s channel.
- `POST /api/ask` — searches only the authenticated creator’s approved lore, or approved lore for the public `channel_login` parameter used by an overlay.
- `GET /api/status` — returns non-secret service and creator connection status.
- `/overlay/<channel-login>` — public OBS-friendly view for that channel; the old `/overlay` redirects the signed-in creator to their overlay.

The answer flow uses keyword relevance, not vector search. The model receives only relevant approved lore. The API includes the lore sources used; the public overlay’s channel is selected by login, never an arbitrary database ID.

In OBS, add a Browser Source with the deployed URL `https://<render-web-host>/overlay/<channel-login>`. LORE runs on the Render web service, so the computer running OBS must have Internet access.

## Render deployment

The Render Web Service uses:

```text
Build: pnpm install --frozen-lockfile && pnpm build
Start: pnpm start
```

The Render Background Worker uses:

```text
Build: pnpm install --frozen-lockfile
Start: pnpm worker
```

Both services use Node.js 22.23.4 and the same `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, Twitch app credentials, and `TWITCH_TOKEN_ENCRYPTION_KEY`. The web service also needs `TWITCH_REDIRECT_URI` and `APP_ORIGIN`. The worker stores refreshed token pairs in Supabase, so it does not depend on a persistent local token file or Render disk. Keep exactly one worker instance to avoid opening duplicate socket sets.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Automated tests use local data or mocks; they do not claim to prove live Twitch delivery. Live chat checks must use a real connected creator stream. Never fabricate an EventSub notification or chat result.

## How Codex was used

OpenAI Codex helped inspect the existing LORE application, plan the multi-creator architecture, implement the Twitch OAuth and EventSub lifecycle, scope the API and Lorebook by creator, add the `!asklore` flow and database migrations, and update deployment instructions. Live external changes are verified against their service responses; no successful result is claimed without evidence.
