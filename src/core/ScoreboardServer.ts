import * as http from "http";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

export class ScoreboardServer {
	private server: http.Server | null = null;
	private stats: PlayerStats[] = [];
	private todayStats: PlayerStats[] = [];
	private lastUpdated: Date | null = null;

	constructor(private logger: Logger) {}

	start(port: number): void {
		this.server = http.createServer((req, res) => {
			if (req.url === "/api/stats") {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				});
				res.end(JSON.stringify({ stats: this.stats, lastUpdated: this.lastUpdated }));
			} else if (req.url === "/api/stats/today") {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				});
				res.end(JSON.stringify({ stats: this.todayStats, lastUpdated: this.lastUpdated }));
			} else {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(this.buildHtml());
			}
		});

		this.server.listen(port, "127.0.0.1", () => {
			this.logger.info(`Scoreboard: HTTP server at http://127.0.0.1:${port}`);
		});

		this.server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				this.logger.warn(`Scoreboard: Port ${port} already in use — scoreboard disabled`);
			} else {
				this.logger.error(`Scoreboard: Server error: ${err.message}`);
			}
		});
	}

	updateStats(stats: PlayerStats[]): void {
		this.stats = stats;
		this.lastUpdated = new Date();
		this.logger.info(`Scoreboard: Stats updated (${stats.length} players)`);
	}

	updateTodayStats(stats: PlayerStats[]): void {
		this.todayStats = stats;
	}

	stop(): void {
		this.server?.close();
		this.server = null;
	}

	private buildHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Digiwise Dart League</title>
<style>
  /* Load Axiforma if font files are placed in the app's static directory.
     Falls back to Segoe UI (Windows system font) if not available. */
  :root {
    --gold:       #d8c281;
    --bg:         #313535;
    --bg-card:    #3a3f3f;
    --secondary:  #54595F;
    --dim:        #464b4b;
    --text:       #ffffff;
    --font-body:  "Axiforma Regular", "Segoe UI", sans-serif;
    --font-heavy: "Axiforma Heavy", "Segoe UI", sans-serif;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    height: 100vh;
    overflow: hidden;
  }

  /* ── View shell ── */
  .view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 24px 36px 16px;
    opacity: 0;
    transition: opacity 0.8s ease;
    pointer-events: none;
  }
  .view.active { opacity: 1; pointer-events: auto; }

  /* ── Brand header (shown in every view) ── */
  .brand-bar {
    display: flex;
    align-items: center;
    gap: 18px;
    padding-bottom: 18px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--gold);
    flex-shrink: 0;
  }
  .brand-logo { height: 30px; }
  .brand-divider { width: 1px; height: 26px; background: var(--secondary); }
  .brand-league {
    font-family: var(--font-heavy);
    font-size: 1rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .view-label {
    margin-left: auto;
    font-family: var(--font-heavy);
    font-size: 1rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--secondary);
  }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; }

  thead th {
    padding: 8px 18px 12px;
    text-align: center;
    font-family: var(--font-heavy);
    font-size: 0.88rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--gold);
    border-bottom: 1px solid var(--dim);
  }
  thead th:nth-child(2) { text-align: left; }

  tbody tr { border-bottom: 1px solid var(--dim); }

  tbody td {
    padding: 15px 18px;
    text-align: center;
    font-size: 1.95rem;
  }
  tbody td:nth-child(2) {
    text-align: left;
    font-family: var(--font-heavy);
    font-size: 2.1rem;
  }

  .rank { font-size: 1.4rem; color: var(--dim); min-width: 40px; }
  .rank-1 { color: var(--gold);  font-family: var(--font-heavy); }
  .rank-2 { color: #C0C0C0; font-family: var(--font-heavy); }
  .rank-3 { color: #CD7F32; font-family: var(--font-heavy); }

  .win-pct { font-family: var(--font-heavy); font-size: 2.1rem; color: var(--gold); }
  .zero { color: var(--dim); }

  .no-data {
    color: var(--secondary);
    font-size: 1.8rem;
    text-align: center;
    margin-top: 80px;
  }

  /* ── Hall of Fame cards ── */
  .cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    flex: 1;
  }

  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--dim);
    border-radius: 10px;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }
  .stat-card.has-data { border-color: var(--gold); }

  .card-icon { font-size: 2rem; }
  .card-title {
    font-family: var(--font-heavy);
    font-size: 0.8rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--secondary);
  }
  .card-player {
    font-family: var(--font-heavy);
    font-size: 2.8rem;
    color: var(--gold);
    line-height: 1.1;
  }
  .card-value { font-size: 1.35rem; color: #a0a8a8; }
  .card-empty .card-player { color: var(--dim); }
  .card-empty .card-value  { color: var(--dim); }

  footer {
    position: fixed;
    bottom: 8px;
    right: 18px;
    color: var(--dim);
    font-size: 0.75rem;
  }
</style>
</head>
<body>

<!-- View A: Leaderboard -->
<div class="view active" id="view-leaderboard">
  <div class="brand-bar">
    <svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 193.17 49.39"><path d="M22.56 37.57A12.06 12.06 0 0115 39.94c-9.12 0-15-6.2-15-14.84 0-8.26 5.83-15 14.57-15a13.5 13.5 0 017.29 1.78V0h8.69v39.46h-8zm-7.18-5.4c4.27 0 6.75-3.18 6.75-7.18s-2.64-7.23-6.75-7.23S8.64 20.94 8.64 25s2.75 7.17 6.74 7.17zM42.4 39.46h-8.69V10.58h8.69zM66.37 10.58h8.15v24.07c0 10.8-6.42 14.74-15.71 14.74A23 23 0 0148.45 47L51 40.27a19.79 19.79 0 007.83 1.67c3.94 0 7-1.4 7-4.21A10.12 10.12 0 0159 39.94c-9 0-15-6-15-14.84 0-8.26 5.94-15 14.69-15a11.71 11.71 0 017.66 2.32zm-7 21.64c4.26 0 6.74-3.18 6.74-7.17s-2.64-7.24-6.74-7.24-6.71 3.19-6.71 7.24 2.75 7.17 6.75 7.17zM86.33 39.46h-8.69V10.58h8.69zM118 28.28l3.94-17.7h9l-7.66 28.88h-9.61l-4.59-16.3-4.43 16.3h-9.79l-8.09-28.88h9.82l3.89 17.7 4.15-17.7h9.23zM140.24 39.46h-8.69V10.58h8.69zM42.4 0h-8.69v7.19h8.69zM86.33 0h-8.69v7.19h8.69zM140.24 0h-8.69v7.19h8.69zM153.25 20.57c1.24.27 2.54.48 3.51.75 5 1.4 7.29 3.73 7.29 9 0 6.8-5.24 9.55-11 9.55-8.53 0-11-4.85-10.8-9.87h8.26c-.05 1.45.43 3 2.64 3 1.46 0 2.49-.65 2.49-1.78s-.6-1.73-2.38-2.11a34.56 34.56 0 01-4.38-1.11c-4.21-1.46-6.15-4.43-6.15-8.74 0-5.62 4.53-9 10.47-9 6.15 0 10.31 2.75 10.36 9.39h-7.93c-.06-1.72-.87-2.8-2.59-2.8-1.3 0-2.11.7-2.11 1.78s.7 1.61 2.32 1.94zM173.8 27.85c.37 2.75 2.53 4.43 5.88 4.43a6.71 6.71 0 005.88-3.4l6.64 3.88c-1.62 3.35-5.4 7.18-12.57 7.18-8.8 0-14.85-5.56-14.85-14.79 0-8.63 5.78-15.06 14.2-15.06 8.85 0 14.19 5.78 14.19 14.42 0 .86 0 1.88-.1 3.34zm.21-6.1h10.15a4.86 4.86 0 00-5.16-4.42 4.76 4.76 0 00-5 4.42z" fill="#d8c281"/></svg>
    <div class="brand-divider"></div>
    <span class="brand-league">Dart League</span>
    <span class="view-label">Scoreboard</span>
  </div>
  <table id="table">
    <thead>
      <tr>
        <th>#</th>
        <th>Player</th>
        <th>Games</th>
        <th>Wins</th>
        <th>Win %</th>
        <th>Kills ⚔️</th>
        <th>Deaths 💀</th>
        <th>100+</th>
        <th>Best round</th>
        <th>180s</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <p class="no-data" id="no-data" style="display:none">No stats yet — play some games!</p>
</div>

<!-- View B: Hall of Fame -->
<div class="view" id="view-cards">
  <div class="brand-bar">
    <svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 193.17 49.39"><path d="M22.56 37.57A12.06 12.06 0 0115 39.94c-9.12 0-15-6.2-15-14.84 0-8.26 5.83-15 14.57-15a13.5 13.5 0 017.29 1.78V0h8.69v39.46h-8zm-7.18-5.4c4.27 0 6.75-3.18 6.75-7.18s-2.64-7.23-6.75-7.23S8.64 20.94 8.64 25s2.75 7.17 6.74 7.17zM42.4 39.46h-8.69V10.58h8.69zM66.37 10.58h8.15v24.07c0 10.8-6.42 14.74-15.71 14.74A23 23 0 0148.45 47L51 40.27a19.79 19.79 0 007.83 1.67c3.94 0 7-1.4 7-4.21A10.12 10.12 0 0159 39.94c-9 0-15-6-15-14.84 0-8.26 5.94-15 14.69-15a11.71 11.71 0 017.66 2.32zm-7 21.64c4.26 0 6.74-3.18 6.74-7.17s-2.64-7.24-6.74-7.24-6.71 3.19-6.71 7.24 2.75 7.17 6.75 7.17zM86.33 39.46h-8.69V10.58h8.69zM118 28.28l3.94-17.7h9l-7.66 28.88h-9.61l-4.59-16.3-4.43 16.3h-9.79l-8.09-28.88h9.82l3.89 17.7 4.15-17.7h9.23zM140.24 39.46h-8.69V10.58h8.69zM42.4 0h-8.69v7.19h8.69zM86.33 0h-8.69v7.19h8.69zM140.24 0h-8.69v7.19h8.69zM153.25 20.57c1.24.27 2.54.48 3.51.75 5 1.4 7.29 3.73 7.29 9 0 6.8-5.24 9.55-11 9.55-8.53 0-11-4.85-10.8-9.87h8.26c-.05 1.45.43 3 2.64 3 1.46 0 2.49-.65 2.49-1.78s-.6-1.73-2.38-2.11a34.56 34.56 0 01-4.38-1.11c-4.21-1.46-6.15-4.43-6.15-8.74 0-5.62 4.53-9 10.47-9 6.15 0 10.31 2.75 10.36 9.39h-7.93c-.06-1.72-.87-2.8-2.59-2.8-1.3 0-2.11.7-2.11 1.78s.7 1.61 2.32 1.94zM173.8 27.85c.37 2.75 2.53 4.43 5.88 4.43a6.71 6.71 0 005.88-3.4l6.64 3.88c-1.62 3.35-5.4 7.18-12.57 7.18-8.8 0-14.85-5.56-14.85-14.79 0-8.63 5.78-15.06 14.2-15.06 8.85 0 14.19 5.78 14.19 14.42 0 .86 0 1.88-.1 3.34zm.21-6.1h10.15a4.86 4.86 0 00-5.16-4.42 4.76 4.76 0 00-5 4.42z" fill="#d8c281"/></svg>
    <div class="brand-divider"></div>
    <span class="brand-league">Dart League</span>
    <span class="view-label">Hall of Fame</span>
  </div>
  <div class="cards-grid">
    <div class="stat-card" id="card-eliminator"></div>
    <div class="stat-card" id="card-180king"></div>
    <div class="stat-card" id="card-highround"></div>
    <div class="stat-card" id="card-buster"></div>
    <div class="stat-card" id="card-closer"></div>
  </div>
</div>

<!-- View C: Today -->
<div class="view" id="view-today">
  <div class="brand-bar">
    <svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 193.17 49.39"><path d="M22.56 37.57A12.06 12.06 0 0115 39.94c-9.12 0-15-6.2-15-14.84 0-8.26 5.83-15 14.57-15a13.5 13.5 0 017.29 1.78V0h8.69v39.46h-8zm-7.18-5.4c4.27 0 6.75-3.18 6.75-7.18s-2.64-7.23-6.75-7.23S8.64 20.94 8.64 25s2.75 7.17 6.74 7.17zM42.4 39.46h-8.69V10.58h8.69zM66.37 10.58h8.15v24.07c0 10.8-6.42 14.74-15.71 14.74A23 23 0 0148.45 47L51 40.27a19.79 19.79 0 007.83 1.67c3.94 0 7-1.4 7-4.21A10.12 10.12 0 0159 39.94c-9 0-15-6-15-14.84 0-8.26 5.94-15 14.69-15a11.71 11.71 0 017.66 2.32zm-7 21.64c4.26 0 6.74-3.18 6.74-7.17s-2.64-7.24-6.74-7.24-6.71 3.19-6.71 7.24 2.75 7.17 6.75 7.17zM86.33 39.46h-8.69V10.58h8.69zM118 28.28l3.94-17.7h9l-7.66 28.88h-9.61l-4.59-16.3-4.43 16.3h-9.79l-8.09-28.88h9.82l3.89 17.7 4.15-17.7h9.23zM140.24 39.46h-8.69V10.58h8.69zM42.4 0h-8.69v7.19h8.69zM86.33 0h-8.69v7.19h8.69zM140.24 0h-8.69v7.19h8.69zM153.25 20.57c1.24.27 2.54.48 3.51.75 5 1.4 7.29 3.73 7.29 9 0 6.8-5.24 9.55-11 9.55-8.53 0-11-4.85-10.8-9.87h8.26c-.05 1.45.43 3 2.64 3 1.46 0 2.49-.65 2.49-1.78s-.6-1.73-2.38-2.11a34.56 34.56 0 01-4.38-1.11c-4.21-1.46-6.15-4.43-6.15-8.74 0-5.62 4.53-9 10.47-9 6.15 0 10.31 2.75 10.36 9.39h-7.93c-.06-1.72-.87-2.8-2.59-2.8-1.3 0-2.11.7-2.11 1.78s.7 1.61 2.32 1.94zM173.8 27.85c.37 2.75 2.53 4.43 5.88 4.43a6.71 6.71 0 005.88-3.4l6.64 3.88c-1.62 3.35-5.4 7.18-12.57 7.18-8.8 0-14.85-5.56-14.85-14.79 0-8.63 5.78-15.06 14.2-15.06 8.85 0 14.19 5.78 14.19 14.42 0 .86 0 1.88-.1 3.34zm.21-6.1h10.15a4.86 4.86 0 00-5.16-4.42 4.76 4.76 0 00-5 4.42z" fill="#d8c281"/></svg>
    <div class="brand-divider"></div>
    <span class="brand-league">Dart League</span>
    <span class="view-label">Today</span>
  </div>
  <table id="table-today">
    <thead>
      <tr>
        <th>#</th>
        <th>Player</th>
        <th>Games</th>
        <th>Wins</th>
        <th>Win %</th>
        <th>Kills ⚔️</th>
        <th>Deaths 💀</th>
        <th>Best round</th>
      </tr>
    </thead>
    <tbody id="tbody-today"></tbody>
  </table>
  <p class="no-data" id="no-data-today" style="display:none">No games today yet — get throwing!</p>
</div>

<footer id="footer"></footer>

<script>
const SWITCH_MS = 15000;
const VIEWS = ['leaderboard', 'cards', 'today'];
let currentViewIdx = 0;

function switchView() {
  const ids = { leaderboard: 'view-leaderboard', cards: 'view-cards', today: 'view-today' };
  document.getElementById(ids[VIEWS[currentViewIdx]]).classList.remove('active');
  currentViewIdx = (currentViewIdx + 1) % VIEWS.length;
  document.getElementById(ids[VIEWS[currentViewIdx]]).classList.add('active');
}

setInterval(switchView, SWITCH_MS);

function buildCard(id, icon, title, stats, key, format) {
  const card = document.getElementById(id);
  const sorted = [...stats].sort((a, b) => (b[key] || 0) - (a[key] || 0));
  const best = sorted[0];
  const isEmpty = !best || !(best[key] > 0);

  if (isEmpty) {
    card.className = 'stat-card card-empty';
    card.innerHTML =
      '<span class="card-icon">' + icon + '</span>' +
      '<span class="card-title">' + title + '</span>' +
      '<span class="card-player">—</span>' +
      '<span class="card-value">No data yet</span>';
  } else {
    card.className = 'stat-card has-data';
    card.innerHTML =
      '<span class="card-icon">' + icon + '</span>' +
      '<span class="card-title">' + title + '</span>' +
      '<span class="card-player">' + best.nickname + '</span>' +
      '<span class="card-value">' + format(best[key]) + '</span>';
  }
}

function renderCards(stats) {
  buildCard('card-eliminator', '💀', 'The Eliminator', stats, 'eliminations',
    function(v) { return v + (v === 1 ? ' elimination' : ' eliminations'); });
  buildCard('card-180king', '🎯', 'The 180 King', stats, 'oneEighties',
    function(v) { return v + ' × 180'; });
  buildCard('card-highround', '🔥', 'High Round', stats, 'highestRound',
    function(v) { return v + ' pts in one round'; });
  buildCard('card-buster', '💥', 'Bust Machine', stats, 'busts',
    function(v) { return v + (v === 1 ? ' bust' : ' busts'); });
  buildCard('card-closer', '🏆', 'The Closer', stats, 'highestCheckout',
    function(v) { return 'Checked out on ' + v; });
}

async function refresh() {
  try {
    const [res, resToday] = await Promise.all([fetch('/api/stats'), fetch('/api/stats/today')]);
    const data = await res.json();
    const dataToday = await resToday.json();
    const stats = data.stats || [];
    const todayStats = dataToday.stats || [];

    // Leaderboard
    const hasData = stats.some(function(p) { return p.gamesPlayed > 0; });
    document.getElementById('table').style.display = hasData ? '' : 'none';
    document.getElementById('no-data').style.display = hasData ? 'none' : 'block';

    const sorted = [...stats].sort(function(a, b) {
      return (b.winPct - a.winPct) || (b.wins - a.wins);
    });
    const medals = ['🥇', '🥈', '🥉'];
    document.getElementById('tbody').innerHTML = sorted.map(function(p, i) {
      const rankClass = i < 3 ? ' rank-' + (i + 1) : '';
      const medal = i < 3 ? medals[i] : (i + 1);
      const winPctStr = p.gamesPlayed > 0 ? p.winPct.toFixed(0) + '%' : '—';
      const z = p.gamesPlayed === 0 ? ' zero' : '';
      return '<tr>' +
        '<td class="rank' + rankClass + '">' + medal + '</td>' +
        '<td>' + p.nickname + '</td>' +
        '<td class="' + z + '">' + p.gamesPlayed + '</td>' +
        '<td class="' + z + '">' + p.wins + '</td>' +
        '<td class="win-pct' + z + '">' + winPctStr + '</td>' +
        '<td class="' + z + '">' + (p.eliminations || 0) + '</td>' +
        '<td class="' + z + '">' + (p.eliminated || 0) + '</td>' +
        '<td class="' + z + '">' + (p.hundredPlus || 0) + '</td>' +
        '<td class="' + z + '">' + (p.highestRound || 0) + '</td>' +
        '<td class="' + z + '">' + (p.oneEighties || 0) + '</td>' +
        '</tr>';
    }).join('');

    // Today
    const hasTodayData = todayStats.some(function(p) { return p.gamesPlayed > 0; });
    document.getElementById('table-today').style.display = hasTodayData ? '' : 'none';
    document.getElementById('no-data-today').style.display = hasTodayData ? 'none' : 'block';
    const sortedToday = [...todayStats].sort(function(a, b) {
      return (b.wins - a.wins) || (b.gamesPlayed - a.gamesPlayed);
    });
    document.getElementById('tbody-today').innerHTML = sortedToday.map(function(p, i) {
      const rankClass = i < 3 ? ' rank-' + (i + 1) : '';
      const medals = ['🥇', '🥈', '🥉'];
      const medal = i < 3 ? medals[i] : (i + 1);
      const winPctStr = p.gamesPlayed > 0 ? p.winPct.toFixed(0) + '%' : '—';
      const z = p.gamesPlayed === 0 ? ' zero' : '';
      return '<tr>' +
        '<td class="rank' + rankClass + '">' + medal + '</td>' +
        '<td>' + p.nickname + '</td>' +
        '<td class="' + z + '">' + p.gamesPlayed + '</td>' +
        '<td class="' + z + '">' + p.wins + '</td>' +
        '<td class="win-pct' + z + '">' + winPctStr + '</td>' +
        '<td class="' + z + '">' + (p.eliminations || 0) + '</td>' +
        '<td class="' + z + '">' + (p.eliminated || 0) + '</td>' +
        '<td class="' + z + '">' + (p.highestRound || 0) + '</td>' +
        '</tr>';
    }).join('');

    // Cards
    renderCards(stats);

    const ts = data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : 'never';
    document.getElementById('footer').textContent = 'Updated ' + ts;
  } catch(e) {
    console.error('Scoreboard fetch failed:', e);
  }
}

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
	}
}
