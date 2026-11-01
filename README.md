# LORE

LORE is a living memory for Twitch communities. It turns meaningful chat messages, recurring jokes, and community moments into reviewable lore, then answers viewer questions with evidence from approved entries.

## The problem

Twitch communities build shared history quickly, but newcomers often miss the references and regulars have to keep retelling the story. LORE preserves those moments and makes the context easy to find.

## Features

- Lorebook sections for approved memories and proposed entries.
- Streamer approval and rejection for proposed lore, protected by a server-side secret and an HttpOnly session cookie.
- Twitch `channel.chat.message` ingestion over EventSub WebSockets.
- `!lore <moment>` chat commands create proposals; repeated phrases can also create proposals.
- Idempotent proposal creation keyed by the saved Twitch message ID, using a database RPC and transaction lock.
- Answers based on the most relevant approved lore entries, with source messages included. Without a matching entry, LORE responds “I don't know yet.”
- Optional OpenAI Responses API answers; a grounded summary fallback works without an API key or when the model is unavailable.
- A minimal OBS browser overlay at `/overlay`.
- Local demo data for trying the UI without live Twitch or Supabase connections.

LORE currently supports one broadcaster channel. It does not use vector search, Twitch Extensions, or a built-in Twitch OAuth callback flow.

## Architecture and data flow

```text
Twitch chat
  -> EventSub WebSocket worker
  -> chat_messages (unique Twitch message ID)
  -> create_lore_proposal_once database RPC
  -> proposed lore entry
  -> streamer approves or rejects in the Lorebook
  -> /api/ask searches approved entries and returns grounded answers with sources
  -> Lorebook or OBS overlay
```

The worker runs as a separate Node process. It validates the user access token, uses the validated Twitch user ID as the chat reader in the EventSub condition, and uses `TWITCH_BROADCASTER_USER_ID` for the channel. Supabase credentials are used only by server-side code. Local development uses the ignored `data/local.json` demo store; production requires Supabase configuration and fails clearly if it is missing.

## Technology stack

- TypeScript, Next.js App Router, and React
- Twitch EventSub WebSockets and Twitch OAuth user tokens
- Supabase Postgres and the Supabase JavaScript client
- Optional OpenAI Responses API
- Node.js and pnpm

## Prerequisites

- Node.js 22.23.4 (pinned in `package.json`)
- pnpm
- A Supabase project for shared persistence (optional for the local demo)
- A Twitch Developer application and user access/refresh tokens for live chat ingestion (optional for the local demo)
- An OpenAI API key for model-generated answers (optional)

## Install and configure

```sh
pnpm install --frozen-lockfile
Copy-Item .env.example .env   # PowerShell; on macOS/Linux use: cp .env.example .env
```

Fill in only the values needed for the mode you want to run. `.env` is ignored by Git and must stay server-side.

| Variable | Required for | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Model-generated answers | Optional. If unset or unavailable, LORE returns the grounded lore summary. |
| `OPENAI_MODEL` | Optional model override | Optional. The code defaults to `gpt-6-luna`. |
| `SUPABASE_URL` | Shared persistence | Project URL used by server-side database calls. |
| `SUPABASE_SECRET_KEY` | Shared persistence | Server-only Supabase secret key; never expose it to browser code. |
| `LORE_ADMIN_SECRET` | Production lore moderation | Required to unlock approve/reject controls. Use a random secret with at least 32 characters; it is never sent to the client as configuration. |
| `TWITCH_CLIENT_ID` | EventSub worker | Twitch application client ID. |
| `TWITCH_CLIENT_SECRET` | Token refresh | Twitch application secret used for refresh-token exchanges. |
| `TWITCH_ACCESS_TOKEN` | EventSub worker | User access token for the authorized chat reader. |
| `TWITCH_REFRESH_TOKEN` | Automatic token refresh | Refresh token paired with the user access token. Twitch rotates token pairs; the worker stores the latest pair in the ignored `.twitch-token-state.json`. |
| `TWITCH_CHANNEL_LOGIN` | EventSub worker | Broadcaster channel login. |
| `TWITCH_BROADCASTER_USER_ID` | EventSub worker and persistence | Broadcaster ID for the channel to read. |
| `TWITCH_TOKEN_STATE_PATH` | Persistent worker token rotation | Optional path for the rotated access/refresh-token pair. Render example: `/var/data/.twitch-token-state.json`; local default remains `.twitch-token-state.json` in the project root. |

If the configured token-state file exists, its token pair takes precedence over the token values in `.env`. Twitch returns a new refresh token during refresh, and the worker saves the new pair at this path. On Render, attach a persistent disk mounted at `/var/data` to the worker and set `TWITCH_TOKEN_STATE_PATH=/var/data/.twitch-token-state.json`. To switch accounts, stop the worker and handle the token-state file securely before restarting.

Set `NODE_ENV=production` on both Render services. The web service must have `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `LORE_ADMIN_SECRET`; add `OPENAI_API_KEY` only if model answers are wanted. The worker needs the Supabase variables and all Twitch variables above. Never add these secret values to the repository.

## Supabase setup

Create a Supabase project, then run both SQL files in the Supabase SQL Editor, in order:

1. `supabase/migrations/001_lore.sql` creates the channel, chat-message, and lore-entry tables and indexes.
2. `supabase/migrations/002_lore_proposal_idempotency.sql` adds the atomic proposal RPC used to prevent duplicate lore entries from duplicate EventSub deliveries.

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env` or the server environment. The RPC migration must be applied before using the Supabase-backed worker.

`pnpm seed` resets the demo data for the active store. With Supabase configured, it deletes and reseeds chat and lore rows for the configured channel. Run it only on a fresh or disposable project, never on a database whose channel data you want to keep.

## Twitch Developer application setup

1. Create a Twitch application and configure the client ID and client secret.
2. Obtain a user access token and refresh token for the chat-reading account through Twitch’s Authorization Code Grant flow with the existing `user:read:chat` scope. Token acquisition is done outside this app; this repository does not implement an OAuth login/callback UI.
3. Set `TWITCH_CHANNEL_LOGIN` and `TWITCH_BROADCASTER_USER_ID` to the broadcaster channel. The token may belong to a separate chat reader; the worker validates the token and uses that user’s ID for EventSub `condition.user_id`.
4. Start the worker as described below. It validates the token at startup and hourly, refreshes on expiration or an API 401, and connects to the EventSub WebSocket.

The worker listens for chat and saves messages; it does not send messages to Twitch. Keep all token values and the client secret out of browser code, screenshots, logs, and commits.

## Run the app

Start the Next.js frontend:

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). In local development, the app uses local demo storage when Supabase is unconfigured and leaves moderation unlocked unless `LORE_ADMIN_SECRET` is set. Without `OPENAI_API_KEY`, matching approved lore is answered with its grounded summary.

Start the EventSub worker in a second terminal after configuring Twitch and Supabase:

```sh
pnpm worker
```

To load the fictional demo data into the local store, leave Supabase unconfigured and run:

```sh
pnpm seed
```

## Lorebook and API

- `/` — Lorebook with approved memories, a proposed-lore review queue, and the ask form.
- `GET /api/lore` — returns approved entries publicly; proposed and rejected entries require streamer authorization.
- `POST /api/admin/session` — checks the streamer secret and sets an eight-hour HttpOnly moderation cookie. `DELETE` clears the session.
- `PATCH /api/lore/:id` — approves or rejects an entry after streamer authorization.
- `POST /api/ask` — searches approved lore, answers from relevant entries, and returns the source lore and chat messages.
- `GET /api/status` — reports whether the app is using demo or Supabase storage and whether Twitch/OpenAI settings are present.

The ask flow uses keyword matching over approved lore; it does not use embeddings or vector search. The model receives only the selected lore entries, and the API returns their sources. In production, enter `LORE_ADMIN_SECRET` in the Lorebook's streamer access field to unlock the private review queue. The secret is checked server-side and is not returned or logged.

## OBS overlay

Add a Browser Source in OBS pointing to:

```text
http://localhost:3000/overlay
```

To open the overlay with an initial question, use the `q` query parameter, for example:

```text
http://localhost:3000/overlay?q=What%20was%20the%20Banana%20Incident%3F
```

The overlay renders the answer and lore source titles. The Next.js app must be reachable from the machine running OBS.

## Tests and validation

```sh
pnpm typecheck
pnpm lint
node --experimental-strip-types --test tests/lore-proposal-idempotency.test.mjs tests/render-production-guards.test.mjs
pnpm build
```

The tests cover idempotent proposal creation, the Supabase RPC request arguments, production Supabase configuration guards, signed moderation sessions, and Twitch token rotation at a configurable path. The RPC test uses a mock PostgREST response; it is not a live database concurrency test.

## How Codex was used

OpenAI Codex was used during development to inspect the starter project, shape the MVP architecture, implement the Next.js UI and APIs, connect Twitch EventSub and Supabase, add the idempotency migration and tests, and review the setup and submission documentation. Live-service checks used real Twitch and Supabase connections without exposing credential values.
