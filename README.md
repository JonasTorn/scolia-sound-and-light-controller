# Scolia Light & Sound Controller

Styr LightShark-belysning och ljudeffekter i realtid baserat på Scolia darttavla-events. Inkluderar poängtavla (scoreboard) med live-statistik.

## Funktioner

- **Ljuseffekter** — LED-färger matchar darttavlans färger (röda/gröna segment, bullseye, miss)
- **Ljudeffekter** — Unreal Tournament-tema med segment-specifika ljud (Godlike, Dominating, etc.)
- **20 special events** — 180, 120, 1-2-3, 007, 420, 1337, 69, 911, med flera
- **Playwright DOM-övervakning** — Detekterar bust, leg won, set won, eliminated via Scolias webbapp
- **Scoreboard** — Live-statistik med historik, servad på port 3456
- **KNX-integration** — Styr rumsbelysning via KNX IP-gateway (valfritt)

## Arkitektur

TypeScript OOP med dependency injection. Körs via pm2 på Windows PC (MadrixPC).

```
src/
├── index.ts                    # Entry point (6 rader)
├── Application.ts              # Bootstrap, WebSocket, event-routing
├── core/
│   ├── ConfigManager.ts        # Config-laddning (config.json + config.secrets.json)
│   ├── GameState.ts            # State + persistens → data/throw-history.json
│   ├── EventOrchestrator.ts    # 10-stegs throw-pipeline
│   ├── EffectResolver.ts       # Kast → ljuseffekt-mappning
│   ├── SpecialEventDetector.ts # 20 data-drivna special events
│   ├── GameLog.ts              # Live-statistik → data/game-log.json
│   ├── HistoryStore.ts         # Historisk Scolia-export → data/scolia-history.json
│   └── ScoreboardServer.ts     # HTTP-server för scoreboard (port 3456)
├── controllers/
│   ├── LightSharkController.ts # OSC/UDP
│   ├── SoundController.ts      # Cross-platform ljud
│   ├── KNXController.ts        # KNX/IP gateway
│   └── PlaywrightController.ts # Browser + DOM-polling
├── config/
│   └── specialEvents.config.ts # Deklarativa special event-definitioner
└── utils/
    ├── Logger.ts               # Loggning med filrotation
    ├── SectorParser.ts         # Parsear "s14", "d20", "t19" → poäng
    └── TypeValidator.ts        # Schema-validering

data/                           # Runtime-filer (gitignorerade utom scolia-history.json)
├── scolia-history.json         # En-gångs Scolia-export (committas)
├── game-log.json               # Live-spellogg (genereras automatiskt)
├── throw-history.json          # Kasttillstånd för special events (genereras automatiskt)
└── scolia-cookies.json         # Playwright-cookies (genereras automatiskt)

scripts/
└── export-scolia-history.js    # Klistra in i Chrome DevTools för att exportera historik
```

## Systemkrav

- Node.js v18+
- LightShark med OSC aktiverat
- Scolia darttavla med API-access
- Ljud: Windows (PowerShell), macOS (afplay), Linux (aplay/mpg123)
- KNX (valfritt): KNX IP-gateway på nätverket

## Installation

```bash
git clone <repo-url>
cd scolia-sound-and-light-controller
npm install
npx playwright install chromium
```

## Konfiguration

Appen använder två config-filer som deep-mergas vid start:

- **`config.json`** — Committas till git. Innehåller struktur och standardvärden (inga hemligheter).
- **`config.secrets.json`** — Gitignorerad. Innehåller riktiga credentials.

Minsta möjliga `config.secrets.json`:
```json
{
  "scolia": { "serialNumber": "...", "accessToken": "..." },
  "lightshark": { "ip": "192.168.6.242" },
  "playwright": { "credentials": { "email": "din@email.com", "password": "ditt-lösenord" } }
}
```

### Viktiga config-sektioner

**Scolia:**
```json
"scolia": {
  "simulationMode": false,
  "reconnectDelay": 5000
}
```
Sätt `simulationMode: true` för att köra utan Scolia-anslutning.

**Scoreboard:**
```json
"scoreboard": {
  "enabled": true,
  "port": 3456,
  "idleDelayMs": 30000,
  "vipMinPlayers": 3,
  "seasonStartDate": "2026-08-10"
}
```

**Spelare (VIP):**
```json
"players": {
  "Groggen": {},
  "Luca": {},
  "Sony": {},
  "T10": {},
  "Laser": {}
}
```
Matcher räknas mot scoreboard bara om ALLA spelare finns i denna lista och minst `vipMinPlayers` spelar.

**Ljud:**
```json
"sound": {
  "enabled": true,
  "soundsDir": "./sounds",
  "sounds": {
    "miss": { "file": "miss.wav" },
    "triple_20": { "file": "godlike.wav" },
    "bust": { "file": "tjockis.wav", "volume": 2.0 }
  }
}
```
Segment-specifika ljud (t.ex. `triple_20`) har prioritet över generella (`triple`). Varje ljud stödjer `volume` (0.0–2.0) och `enabled` (true/false).

## Körning

```bash
# Produktion
npm start

# Simulator (testa effekter utan hårdvara)
npm run simulate

# Bygg TypeScript
npm run build

# Tester
npm test
```

## Deployment (Remote PC — MadrixPC)

Appen körs som pm2-process på Windows PC (`madrix@100.117.114.10`).  
**OBS:** Appen körs från kompilerad JS i `dist/` — `git pull` ensamt räcker inte.

```bash
# Efter varje kodändring:
git pull && npm run build && pm2 restart scolia-new

# Kontrollera status:
pm2 show scolia-new
pm2 logs scolia-new --lines 30

# Rensa loggar (utan restart):
pm2 flush scolia-new
```

Ljud-filer synkas **inte** via git (`sounds/` är gitignorerad). Kopiera nya ljud manuellt:
```bash
scp sounds/filnamn.wav madrix@100.117.114.10:~/scolia-new/sounds/
# Eller synka hela sounds/-mappen:
npm run sync-assets
```

## Scoreboard

Scoreboard serveras på port 3456 och visar live-statistik för säsongen.

**Visa från Mac** (SSH port forwarding):
```bash
# Öppna ett nytt terminalfönster (inte det SSH:ade) och kör:
ssh -L 3456:127.0.0.1:3456 madrix@100.117.114.10
# Öppna sedan: http://127.0.0.1:3456
# Raw stats JSON: http://127.0.0.1:3456/api/stats
```

**Statistik som trackas:**
- Spelade matcher, vinster, vinstprocent
- Eliminations (orsakade) / Eliminated (drabbad av)
- 100+ rundor, bästa runda (poäng per 3 pilar)
- 180:or, busts, högsta checkout

**Datakällor:**
- `data/scolia-history.json` — Historisk export från Scolias API (kör `scripts/export-scolia-history.js` i Chrome DevTools som Laser)
- `data/game-log.json` — Live-logg från matcher medan appen kör

Dubbel-räkning förhindras automatiskt: GameLog räknar bara matcher som startat **efter** historik-exportens `fetchedAt`-tidsstämpel.

**Uppdatera historik** (ny säsong eller ny export):
1. Öppna `game.scoliadarts.com` i Chrome, logga in som Laser
2. Öppna DevTools → Console, klistra in hela `scripts/export-scolia-history.js`
3. Vänta tills nedladdning startar, spara filen som `data/scolia-history.json`
4. Committa och pusha, sedan deploy på remote

## Ljuslogik

Prioritetsordning vid kast:

1. Miss → noScoreExecutor (lampor släcks)
2. Bullseye 50p → bullseyeExecutor + strobe overlay 3s
3. Bull 25p → greenExecutor
4. Triple 20 → redExecutor + strobe overlay 3s
5. Dubbel/Triple på rött segment → redExecutor
6. Dubbel/Triple på grönt segment → greenExecutor
7. Singel → Neutral

Executors är Flash-mode (håller tills explicit release). Takeout → cleanup/release.

## Special Events (20 st)

| Event | Trigger | Ljud |
|-------|---------|------|
| 180 | 3 kast = 180p | monsterkill.wav |
| 120 | 2× Triple 20 i rad | 120.wav |
| 1-2-3 | S1 → S2 → S3 i följd | one_two_three.wav |
| 3× Miss | 3 missar i rad | lostmatch.wav |
| 007 | Miss → Miss → S7 | — |
| 420 | 4p → 20p | — |
| 1337 | 13p → 3p → 7p | — |
| 69 | 6p → 9p | — |
| 911 | S9 → S1 → S1 | nine_one_one.wav |
| 112 | S1 → S1 → S2 | one_one_two.wav |
| ... | (se specialEvents.config.ts) | |

## Lägg till nytt ljud

```bash
# Ladda ner från YouTube:
yt-dlp -x --audio-format wav -o "sounds/namn.%(ext)s" "https://youtu.be/VIDEO_ID"

# Konvertera till PCM WAV (krävs för Windows):
ffmpeg -i sounds/namn.wav -acodec pcm_s16le -ar 44100 -ac 2 sounds/namn_pcm.wav -y
mv sounds/namn_pcm.wav sounds/namn.wav

# Lägg till i config.json → sound.sounds:
"mitt_event": { "file": "namn.wav", "volume": 1.0 }
```

## Felsökning

**LightShark svarar inte:**
- Kontrollera IP i `config.secrets.json`
- Verifiera att OSC är aktiverat i LightShark (Settings → Network → OSC)

**Scolia-anslutning misslyckas:**
- Kontrollera `serialNumber` och `accessToken` i `config.secrets.json`
- Verifiera att darttavlan är online

**Playwright-problem:**
- Kör `npx playwright install chromium` om browser saknas
- Ta bort `data/scolia-cookies.json` för att tvinga ny inloggning
- Kolla loggar: `pm2 logs scolia-new --lines 50`

**Scoreboard visar fel stats:**
- Kör `http://127.0.0.1:3456/api/stats` för att se rådata
- Kontrollera `data/game-log.json` på remote för loggade matcher
- Re-exportera historik om något saknas (se Scoreboard-sektionen ovan)
