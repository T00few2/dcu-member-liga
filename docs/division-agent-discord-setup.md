# Division agent on Discord: setup

The Discord bot answers riders about their division in a help channel and posts every
proposal and draft answer in an admin channel for **Approve / Edit / Reject** or
**Send / Edit / Reject**. All logic lives in the league backend; the bot (`discord-bot/`,
a Render worker) only relays messages.

Never paste tokens or secrets into chats, issues or commits. Channel and role IDs are not secret.

## 1. Discord application and bot

1. Go to <https://discord.com/developers/applications> → **New Application** (for example "DCU Liga").
2. **General Information**: copy the **Application ID** → `DISCORD_CLIENT_ID`.
3. **OAuth2**:
   - **Reset Secret** and copy it → `DISCORD_CLIENT_SECRET`.
   - **Redirects → Add Redirect**: `<BACKEND_URL>/discord/callback`, where `<BACKEND_URL>` is the same value as
     the `BACKEND_URL` GitHub secret. Save.
4. **Installation**: set **Install Link** to **None**, and under Installation Contexts keep only **Guild Install**.
   Save. (A private bot cannot have an install link.)
5. **Bot**:
   - **Reset Token** and copy it → `DISCORD_BOT_TOKEN` (used only in Render).
   - Turn **on** "Message Content Intent".
   - Turn **off** "Public Bot". Save.
6. **Invite**: **OAuth2 → URL Generator** → scope **bot** → permissions *View Channels, Send Messages, Create
   Public Threads, Send Messages in Threads, Read Message History, Embed Links* → open the URL, pick the server,
   **Authorize**. Server admins can do this (it needs *Manage Server*, which Administrator includes; 2FA must be
   on if the server requires it). Try it on a private test server first.

## 2. Discord server

1. User Settings → **Advanced** → turn on **Developer Mode**.
2. Create **#division-help** (public: riders write here) and **#division-admin** (private: admins and the bot).
3. Pick the admin role (or create one). Only members with this role can press the buttons.
4. Right-click → **Copy Channel ID** / **Copy Role ID** → `HELP_CHANNEL_ID`, `ADMIN_CHANNEL_ID`, `ADMIN_ROLE_ID`.

## 3. Secrets

- `BOT_SHARED_SECRET`: a long random string (40+ characters). The backend and the bot get the same value.
- `ANTHROPIC_API_KEY`: <https://console.anthropic.com> → API Keys; set a monthly limit under Billing (about $10).
  Without it the bot still works, but drafts are short template texts.

## 4. GitHub (backend)

Repository **Settings → Secrets and variables → Actions → New repository secret** (repository secrets, not
environment secrets): `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `BOT_SHARED_SECRET`, `ANTHROPIC_API_KEY`.
The next backend deploy picks them up. Riders can then link Discord under *Registrering → Forbindelser*.

## 5. Render (the bot)

1. Render → **New → Blueprint** → this repository. It reads `render.yaml` (worker `dcu-liga-discord-bot`,
   Starter plan, about $7/month).
2. Enter `DISCORD_BOT_TOKEN`, `BOT_SHARED_SECRET` (same as the backend), `HELP_CHANNEL_ID`, `ADMIN_CHANNEL_ID`,
   `ADMIN_ROLE_ID` and `BACKEND_URL`.
3. Deploy. The log shows `Logged in as …` when the bot is connected. Every push to `main` that changes
   `discord-bot/` redeploys it.

## How it works

- A rider writes in **#division-help** → the bot opens a thread and asks the backend. Unlinked riders get a link to
  the app. Only the rider who asked gets answers in their thread; admins may answer there by hand.
- With auto-reply **off** (default; switch on the admin page under *Division Agent*), the rider gets "an admin will
  reply soon" and the draft appears in **#division-admin** with **Send / Edit / Reject**.
- A request to move division becomes an **appeal** post with **Approve / Edit / Reject** (and the transfer preview
  for riders who have raced). The rider is told the outcome in their thread.
- Proposals made by the agent itself also appear in **#division-admin**. Deciding on the admin page instead updates
  the Discord post.
- Riders may send 10 messages per hour.

## Test checklist (test server)

1. Link a test account in the app (*Registrering → Forbindelser → Forbind Discord*).
2. Ask "Hvorfor er jeg i Gold?" and "Why am I in Gold?" → drafts in #division-admin → Send, Edit, Reject.
3. Ask to move down with a reason → appeal post → Approve or Reject → outcome in the rider's thread.
4. Turn auto-reply on → answers go out directly.
