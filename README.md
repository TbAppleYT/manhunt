# manhunt.

Private, location-based hide-and-seek for groups of friends at **Town Center of Virginia Beach**.
A Next.js web app (installable PWA) for iOS, Android and desktop browsers, deployable on Vercel.

> **Still to be confirmed by the owner.** These are temporary prototype choices, not final decisions:
> 1. **Map orientation**: the map opens with west at the top so it matches the visitor-guide sign. The compass button switches to north-up.
> 2. **Marker treatment**:
>    - You are always the blue dot.
>    - Teammates appear as soft glows in their team colour (hiders blue, seekers red), placed on a ~25 m grid. Nobody else is ever shown.
>    - Hiders see only their own group. Seekers see only other seekers.
> 3. **Sector boundaries**: the sector lines in `src/data/sectors.provisional.geojson.json` were traced along the streets on satellite imagery to match your annotated map. They have **not** been checked on-site. Until the host marks them verified in the sector editor, the app only warns players and the host about closed sectors and applies no automatic consequences.
> 4. **Voting rule**: unchanged from the brief. Only closed sectors are blocked; a sector that is already closing can still receive votes.

---

## What's in the box

| Area | Where |
|---|---|
| Game rules engine (server-authoritative, pure TypeScript) | `src/lib/engine/engine.ts` |
| Privacy boundary (what each player may see) | `src/lib/engine/view.ts` |
| Storage: Postgres (Supabase) and in-memory | `src/lib/server/pgStore.ts`, `memoryStore.ts` |
| API routes | `src/app/api/**` |
| Gameplay UI (approved Phase 1 layout) | `src/components/Play.tsx`, `src/app/proto.css` |
| Lobby, teams, groups, settings, permission onboarding | `src/components/Lobby.tsx` |
| Host controls | `src/components/HostPanel.tsx` |
| Developer simulator | `/sim`, `src/components/SimPanel.tsx` |
| Sector editor | `/editor` |
| Audio manager | `src/lib/client/audio.ts`, `src/data/audio-manifest.json` |
| Database migration | `supabase/migrations/0001_init.sql` |
| Supplied assets (unchanged originals) | `assets/supplied/` |
| Phase 1 prototype source + full Esri capture | `assets/prototype/` |

### How it works

- **Server-authoritative.** Every request loads the game in a transaction. It processes any timers that are due (head start, votes, closures, search zones, photo deadlines, clues, GPS freshness), applies the one command and saves. Clients only send what the player is trying to do; the server decides every outcome, including roles, catches, votes and wins.
- **Timers** are absolute server timestamps, and clients correct for clock drift on every response. Pausing freezes them; resuming shifts every pending deadline by the paused time.
- **Concurrency.** In Postgres, each change runs under `SELECT … FOR UPDATE`. The in-memory store uses a per-game lock instead. Repeated command IDs are ignored, so a double tap never counts twice.
- **Realtime.** Clients poll every 1.5 s, which is also how a phone catches up after waking: it gets every event it missed. If Supabase Realtime is configured, the server also sends a version-only message on a public channel, and clients refresh immediately. The message contains no game data.
- **Sessions.** Joining issues a random token, and only its hash is stored. Requests carry `Authorization: Bearer <player>.<token>`.
  - Nicknames are unique within a game.
  - Joins are limited per network (12 a minute and 60 an hour) to stop people guessing codes.
- **Privacy.**
  - Only the latest GPS reading is kept; there is no location history.
  - Players never receive another player's coordinates.
  - The host sees GPS status and accuracy, never positions. The one exception is isolated simulation games.
  - Positions are cleared when a game ends.
  - Games, photos and replays are deleted automatically: games expire after 12 hours, and replays after 24 hours by default.
  - Photos are downscaled and re-encoded on the device, which strips location metadata. They are stored privately and served only to allowed players.

### Rules implemented (from the brief)

**Lobby**
- Six-digit codes, guest nicknames, roles assigned by the host or shuffled at random, readiness, host controls and reconnection.

**Groups**
- No solo hiders; every group needs at least two members.
- Every member must confirm, seekers can't join, and groups lock at start.

**Separation detection**
- Two members count as together if they are within the larger of 35 m or their combined GPS accuracy (capped at 80 m).
- A split has to last 20 s before it counts, so brief GPS jumps don't separate a group.

**Head start**
- A two-minute head start timed by the server, with catch reports disabled.
- The host can pause it or restart it.

**Catches**
- A seeker reports a catch, and the hider confirms or disputes it.
- Disputes go to the host, whose decision is final.
- Only the caught player becomes a seeker, and the change happens immediately.

**Voting** (multi-sector mode only)
- A vote opens every 10 minutes and lasts 2 minutes, with one vote per seeker who was active when it opened.
- It closes early once everyone has voted, and only closed sectors are blocked.
- **Ties** are broken by a seeded random generator stored in the game, choosing among the tied sectors only. Players can't predict the result, and every server instance reaches the same one.
- The host can override the result.

**Closures**
- A sector closes after a 3-minute warning, with the sector number announced.
- If any member of a group is in that sector, the whole group is told to move.
- Sectors stay closed unless the host reopens them.

**Search zones**
- Every 3 minutes one hider group is chosen at random; the same group is never picked twice in a row when another is eligible.
- The zone shrinks in three stages over 60 s. Its centre is offset from the group, so even the smallest stage is approximate.
- If the group is separated, each together-cluster gets its own circle.
- Zones are visible to seekers only.

**Photo hints**
- A photo is requested every 5 minutes, with 2 minutes to send it.
- A group that is together sends one photo; separated members each send their own.
- The host approves or rejects each photo with a reason, and approved photos are visible to everyone.
- A missed deadline gives seekers a 60-second approximate location clue.
- The camera opens only when the player taps.

**Game modes**
- Multi-sector, shared sector, group-selected sectors, and one open sector. Voting is off in every mode except multi-sector.

**Win condition**
- The game ends when one uncaught hider remains, and that player wins.
- A game needs at least two hiders to start, so it can never be won immediately.

**Replays**
- Stylised and labelled as a reconstruction. They use nicknames, the general sector and the time only; no GPS trail exists.

**GPS loss**
- When a player's GPS is lost or blocked, only that player is paused: a paused seeker can't report catches, and paused hiders aren't picked for search zones. The match carries on.

**Sector enforcement**
- Off until the boundaries are verified on-site. Until then, only warnings are shown.

### Audio

The audio manager plays the supplied MP3s under their **real filenames**, one at a time. It queues announcements, respects browser autoplay rules (nothing plays until the first tap), has mute and volume controls, and plays sector-number clips straight after the announcement they belong to. `src/data/audio-manifest.json` was built from the actual archive and checked against your CSV:

- `signal_expired.mp3` is listed in the CSV but **not in the archive**. The app skips it without errors.
- `one_minute.mp3` is in the archive but **not in the CSV**. It is used as the optional "one minute of head start left" clip. I couldn't listen to it to check what it says, so please confirm it fits.
- When a clip is missing, the on-screen countdown still shows everything.

---

## 1. Install dependencies

Requires Node.js 20 or later (tested on Node 22).

```bash
npm ci
cp .env.example .env.local
```

## 2. Configure Supabase (free tier)

1. Create a project at supabase.com (the free tier is enough for private games).
2. Open the **SQL Editor** and run `supabase/migrations/0001_init.sql`. Row Level Security is on with no policies, so the public key can't read anything.
3. Under **Project Settings → Database → Connection string**, copy the **Transaction pooler** URI (port 6543) into `DATABASE_URL`.
4. Optional, for faster updates: set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Free-tier notes:
- The database limit is 500 MB. Photos are about 200–400 KB each and are deleted with their game.
- Projects are **paused after a week of inactivity**; restore yours from the dashboard before game day.
- Realtime free limits are far above what one game needs.

Without `DATABASE_URL`, the app uses an in-memory store. That's fine for `npm run dev`, tests and the simulator, but on Vercel it is refused, because serverless instances don't share memory.

## 3. Configure Mapbox (optional)

Set `NEXT_PUBLIC_MAPBOX_TOKEN` to a **public** token (`pk.…`). In your Mapbox account, restrict the token to your Vercel domain. The style is `satellite-v9`, which is imagery only, so it looks the same in light and dark mode. The free tier includes 50,000 web map loads a month.

Without a token, the app uses the bundled satellite image of Town Center (Esri World Imagery, about 0.6 m per pixel). It needs no account and works offline after the first load.

> The Mapbox map has **not been tested**: there was no token, and Mapbox couldn't be reached from the build environment. The bundled-image map is the tested path.

## 4. Run locally

```bash
npm run dev            # http://localhost:3000
```

Location and the camera need a secure origin. `localhost` counts as secure. To test on a phone over your Wi-Fi, use an HTTPS tunnel (for example `npx localtunnel --port 3000`) or deploy a preview build.

## 5. Run tests

```bash
npm run typecheck
npm run lint
npm test               # engine unit tests + service integration tests (in-memory AND real Postgres)
npm run build
npm run test:e2e       # Playwright: builds must exist; starts `next start` on :3200
```

The integration tests start a temporary real Postgres server using `embedded-postgres`. Set `SKIP_PG=1` to run them against the in-memory store only.

## 6. Test with the simulator

1. Open `/sim`, choose the number of hiders, seekers and group size, a speed (1×, 5×, 10× or 30×) and your role, then tap **Create simulation**.
2. Tap **Before you play**, then **Start head start**.
3. In the game, tap **Simulator** at the bottom-left of the map:
   - **Speed**: 1×, 5×, 10× or 30×.
   - **Skip**: jump to the end of the head start, a vote, a search zone, a photo request or a closure.
   - **Tap the map** to move yourself. Tap a bot to select it, then tap the map to move the bot.
   - **With a bot selected**:
     - Disconnect or restore it, or make its GPS fail.
     - For a hider bot, make it dispute the next catch.
     - For a seeker bot, report a catch.
     - Submit a placeholder photo for review.
4. Bots walk at walking pace and stay with their group unless you move them. They vote, answer catch reports, and send photos marked "simulated".
5. **Several windows:** open `/join?sim=1` in another tab and join with the code. Each tab is a separate player, because simulation sessions are stored per tab.

Simulation games are isolated:
- They can't be joined from the normal join screen.
- Real games refuse simulated locations.
- Simulator commands are rejected in real games.

## 7. Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel (framework: Next.js).
2. Add the environment variables from `.env.example`. At minimum, `DATABASE_URL`.
3. Deploy. `vercel.json` schedules `/api/cron/cleanup` daily; the Hobby plan allows daily cron jobs. Set `CRON_SECRET` to protect it.
4. Check `https://<your-app>/api/health`. It should report `"store":"postgres"`.

The Vercel Hobby (free) plan is for personal, non-commercial use, which fits private games with friends.

## 8. Install the PWA

- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.
- **Desktop Chrome or Edge:** the install icon in the address bar.

The app shell, map image, icons and audio are cached for patchy reception. Game data always comes live from the server.

## 9. Check the sector boundaries on-site

1. As host, open the lobby → **Settings** → **Open sector editor**.
2. Walk each street that forms a sector edge. The provisional lines follow street centrelines: Independence Blvd, Market St, Central Park Ave, Town Center Dr and Constitution Dr running north–south; Virginia Beach Blvd, Bank St, Commerce/Main St and Columbus St running east–west.
3. Drag corners to match. "Move shared corners together" keeps neighbouring sectors from overlapping. Use **Add corner** and **Remove corner** for irregular edges. The editor lists any overlaps or invalid shapes.
4. Under the **Landmarks** tab, drag each landmark to its real storefront and mark it verified. All eight from the brief start as **unverified**, placed at their sector's centre: Psycho Bunny, TowneBank, Shake Shack, Five Below, Regal Theatre, Abercrombie & Fitch, the Fountain and TASTE. The 2023 visitor guide may list businesses that have since changed.
5. Tick **"I walked these boundaries on-site"** and tap **Save to game**. Automatic enforcement (location clues for being in a closed sector) turns on only once this is ticked.
6. Use **Export GeoJSON** to keep a copy, and **Import** to reuse it in later games.

---

## Limitations, accurately

- **Background GPS.** Mobile browsers can't guarantee location updates while the phone is locked or the app is in the background. The server marks a player paused after 45 s without a fresh reading, and they rejoin automatically when readings return.
  - The app asks for a fresh real reading every 12 s and requests a screen wake lock where supported.
  - It never invents a reading.
- **Push notifications** are optional and need VAPID keys. iOS supports web push only for PWAs added to the Home Screen (iOS 16.4 and later). The push path is implemented but **not tested with a real push service**.
- **Supabase Realtime** has not been tested against a live project. Polling, which was tested, is always on as the fallback.
- **Real phones were not used in testing.** GPS and the camera were tested with emulated browsers. The camera flow uses the standard file input with `capture="environment"`.
- **Postgres** was tested with an embedded Postgres 17 server, not a hosted Supabase instance.
- **Timers** are processed whenever any player's device checks in (every 1.5 s while anyone has the app open). If every phone is asleep, the game catches up as soon as one wakes.
- **The bundled satellite image** is a fixed capture with an edge. In north-up view, gray bands appear above and below it; Mapbox removes this.
- **Photo checks** are done by the host by eye. There is **no automatic image validation**.
- **The illustrated map** is the 2023 visitor guide shown as an image. It is not aligned to GPS, so it shows no live markers.
- **Build tooling.** `npm audit` flags a PostCSS advisory inside Next.js's build tooling. It only processes this project's own CSS at build time, never user input.

## Asset credits

- Satellite imagery © Esri, Maxar (World Imagery), captured for the bundled map. For a public deployment, check Esri's attribution and terms, or use Mapbox.
- Town Center visitor guide (2023), annotated sector map, audio pack (ElevenLabs), photo examples and favicon were all supplied by the owner and are kept unchanged in `assets/supplied/`.
