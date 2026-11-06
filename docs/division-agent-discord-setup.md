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

- A user writes in **#division-help** → the bot opens a thread and asks the backend. Only the user who asked gets
  answers in their thread; admins may answer there by hand (the bot never passes their text on as the rider's).
- **League questions** (format, categories, points, verification, Code of Conduct, schedule, standings, results,
  news, data policy) are answered **directly**, for linked and unlinked users alike. The bot only uses live
  sources, so nothing is maintained twice:
  - the site's generated `/llms.txt` (built from the league settings, stage races and news, plus the Code of
    Conduct Google Doc), re-read every 10 minutes;
  - the race schedule, standings and results in Firestore (no event secrets);
  - published news posts and the current data policy.
- **Personal questions** need Discord linked in the app (*Registrering → Forbindelser*): the rider's own
  registration, verification, sign-ups and standing, and their division.
- **Division answers** follow the auto-reply switch on the admin page (*Agent*, "Answer division questions
  on Discord without approval", off by default): when off, the rider gets "an admin will reply soon" and the draft
  appears in **#division-admin** with **Send / Edit / Reject**.
- A request to move division becomes an **appeal** post with **Approve / Edit / Reject** (and the transfer preview
  for riders who have raced). The rider is told the outcome in their thread.
- **Questions the bot cannot answer** are never guessed: they appear in **#division-admin** (with a link to the
  thread and a **Løst / Solved** button) and on the admin page under *Agent → Unanswered questions*.
  Reply to the rider in the thread, then fix the gap at its source (league settings, a news post, the Code of
  Conduct doc or the site text that feeds `/llms.txt`), so the bot can answer it next time.
- Proposals made by the agent itself also appear in **#division-admin**. Deciding on the admin page instead updates
  the Discord post.
- **Talking with the agent in #division-admin**: an admin (with the admin role) mentions the bot, for example
  `@DCU Liga hvorfor er Søren Hansen i Gold?`. The bot opens a thread and answers there; in that thread every
  admin message gets an answer without a new mention (in other threads, mention the bot). The agent can:
  - search riders by name (or Zwift ID); when several riders match it lists them and asks which one;
  - explain why a rider is in their division (locked after racing, held by an admin, held from a predicted
    vELO, automatic from vELO, or self-selected) with the numbers, and which division it would suggest and why;
  - prepare a move on request ("flyt ham til Silver, han er skadet"): it posts a **Move requested by …** card in
    the thread with **Approve / Edit / Reject**. Nothing changes until an admin presses **Approve**; for a rider
    who has raced, approving makes the normal category transfer. An approved move is an admin placement (it
    counts as "placed by hand"), and the agent never closes or replaces a requested move.
  Non-admins in the admin channel are ignored, as is admin chatter that does not mention the bot.
- Each Discord user may send 30 questions per day (Copenhagen time); after that the bot says to try again
  tomorrow, and an admin can still answer by hand.

## Test checklist (test server)

1. Link a test account in the app (*Registrering → Forbindelser → Forbind Discord*).
2. Ask "Hvorfor er jeg i Gold?" and "Why am I in Gold?" → drafts in #division-admin → Send, Edit, Reject.
3. Ask to move down with a reason → appeal post → Approve or Reject → outcome in the rider's thread.
4. Turn auto-reply on → answers go out directly.
5. Ask league questions without approval: "Hvornår er næste løb?", "Hvordan får man point?", "Hvad stod der i den
   seneste nyhed?" (also from an account that has not linked Discord).
6. In #division-admin: `@bot hvorfor er <rider> i <division>?`, then in the thread "hvad ville du foreslå?" and
   "flyt <rider> til <division>" → a move card in the thread → Approve (or Reject) → the card shows the decision.
7. Ask something the site does not cover (for example "Må jeg køre på mountainbike?") → it shows up in
   #division-admin and under *Unanswered questions*; press **Løst / Solved**.
