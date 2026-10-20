# Mindi Coat

Play Mindi Coat online with friends. Private tables, real players only, no bots.

Rules are in [RULES.md](RULES.md). That file is the spec; the engine implements it and the tests check it.

## How it works

```
engine/     Pure rules engine (TypeScript, no I/O). Deal, trump, tricks, scoring.
server/     Node + Socket.IO. Owns every game. Validates every move. Sends each
            player only what they are allowed to see (never other hands).
client/     React app. Asks the server to act; never decides legality itself.
```

* Rooms live in server memory. A restart or a free-tier sleep clears all tables.
* A player is identified by a random token saved in their browser, so a refresh or a dropped connection puts them back in their seat with their hand.
* Disconnect: the game pauses for 2 minutes. After that, anyone with the code can take the seat (and the hand), or a seated player can hand it to a bot.

## Playing on phones

The table is built for phones held sideways. For the most room, install it as an app (no address bar):

* **iPhone:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
* **Android:** open the link in Chrome and tap **Install app** (or use the full-screen button on the table).

## Bots

Short of players? Any seated player can tap **Add bot** on an empty seat. Bots play at one level (Hard):
they imagine many possible ways the unseen cards could be dealt (consistent with everything played so far),
play each one to the end with solid Mindi strategy, and pick the card that wins most often. They only use
what a player in their seat could know; a test proves their decision doesn't change when hidden cards are reshuffled.

Measure strength yourself (identical deals, seats swapped):

```bash
BUDGET=250 npx tsx scripts/tournament.ts 120 hard policy   # Hard vs strategy only
npx tsx scripts/tournament.ts 200 policy random            # strategy vs random play
```

## Run locally

Needs Node 20 or newer.

```bash
npm install
npm run dev        # server on :3001, app on http://localhost:5173
```

Open four browser windows (use private windows or different browsers so each gets its own player token), create a table in one, and join with the code in the others.

```bash
npm test           # engine tests, including 3,000 random full hands, plus live 4-client socket tests
npm run typecheck
npm run build && npm start   # production mode on http://localhost:3001
```

## Deploy on Render (free)

1. Push this repo to GitHub.
2. In Render: **New** > **Blueprint**, pick the repo. `render.yaml` sets everything up.
3. Wait for the first build, then open the URL Render gives you.

Free tier caveat: the service sleeps after about 15 minutes with no traffic. The first visit after that takes 30 to 60 seconds, and any open tables are gone. Fine for a game night; upgrade the plan or add Postgres when that stops being acceptable.

## Not built yet (on purpose)

Public matchmaking, accounts, chat, ranked play, persistence across restarts. See the original brief for the order to add them.
