import * as http from "http";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

export class ScoreboardServer {
	private server: http.Server | null = null;
	private stats: PlayerStats[] = [];
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
<title>Dart Scoreboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #0d0d0d;
    color: #e8e8e8;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    height: 100vh;
    overflow: hidden;
    position: relative;
  }

  .view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 60px;
    opacity: 0;
    transition: opacity 0.8s ease;
    pointer-events: none;
  }

  .view.active {
    opacity: 1;
    pointer-events: auto;
  }

  h1 {
    font-size: 4.5rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f5c518;
    text-shadow: 0 0 60px rgba(245, 197, 24, 0.3);
    margin-bottom: 44px;
  }

  /* ── Leaderboard ── */
  table {
    width: 100%;
    max-width: 1100px;
    border-collapse: collapse;
  }

  thead th {
    padding: 12px 28px;
    text-align: center;
    color: #555;
    font-weight: 600;
    font-size: 1.15rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    border-bottom: 2px solid #1e1e1e;
  }

  thead th:nth-child(2) { text-align: left; }

  tbody tr { border-bottom: 1px solid #161616; }
  tbody tr:hover { background: #111; }

  tbody td {
    padding: 20px 28px;
    text-align: center;
    font-size: 2rem;
  }

  tbody td:nth-child(2) {
    text-align: left;
    font-weight: 700;
    font-size: 2.2rem;
  }

  .rank { font-size: 1.5rem; color: #3a3a3a; min-width: 48px; }
  .rank-1 { color: #FFD700; font-weight: 800; }
  .rank-2 { color: #C0C0C0; font-weight: 800; }
  .rank-3 { color: #CD7F32; font-weight: 800; }

  .win-pct { font-weight: 800; font-size: 2.4rem; color: #f5c518; }
  .zero { color: #2e2e2e; }

  .no-data {
    color: #2a2a2a;
    font-size: 2rem;
    text-align: center;
    padding: 60px 0;
  }

  /* ── Cards ── */
  .cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    max-width: 1100px;
    width: 100%;
  }

  .stat-card {
    background: #111;
    border: 1px solid #1e1e1e;
    border-radius: 20px;
    padding: 36px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    transition: border-color 0.3s;
  }

  .stat-card.has-data { border-color: #2a2a2a; }

  .card-icon { font-size: 2.6rem; }

  .card-title {
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #444;
    margin-top: 4px;
  }

  .card-player {
    font-size: 3.2rem;
    font-weight: 900;
    color: #f5c518;
    text-shadow: 0 0 40px rgba(245, 197, 24, 0.25);
    line-height: 1.1;
  }

  .card-value { font-size: 1.6rem; color: #777; }

  .card-empty .card-player { color: #222; }
  .card-empty .card-value  { color: #222; }

  footer {
    position: fixed;
    bottom: 16px;
    right: 24px;
    color: #1e1e1e;
    font-size: 0.9rem;
  }
</style>
</head>
<body>

<!-- View A: Leaderboard -->
<div class="view active" id="view-leaderboard">
  <h1>🎯 Scoreboard</h1>
  <table id="table">
    <thead>
      <tr>
        <th>#</th>
        <th>Player</th>
        <th>Games</th>
        <th>Wins</th>
        <th>Win %</th>
        <th>Elim.</th>
        <th>180s</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <p class="no-data" id="no-data" style="display:none">No stats yet — play some games!</p>
</div>

<!-- View B: Hall of Fame -->
<div class="view" id="view-cards">
  <h1>⭐ Hall of Fame</h1>
  <div class="cards-grid">
    <div class="stat-card" id="card-eliminator"></div>
    <div class="stat-card" id="card-180king"></div>
    <div class="stat-card" id="card-buster"></div>
    <div class="stat-card" id="card-closer"></div>
  </div>
</div>

<footer id="footer"></footer>

<script>
const SWITCH_MS = 15000;
let currentView = 'leaderboard';

function switchView() {
  const lb = document.getElementById('view-leaderboard');
  const hof = document.getElementById('view-cards');
  if (currentView === 'leaderboard') {
    lb.classList.remove('active');
    hof.classList.add('active');
    currentView = 'cards';
  } else {
    hof.classList.remove('active');
    lb.classList.add('active');
    currentView = 'leaderboard';
  }
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
  buildCard('card-buster', '💥', 'Bust Machine', stats, 'busts',
    function(v) { return v + (v === 1 ? ' bust' : ' busts'); });
  buildCard('card-closer', '🏆', 'The Closer', stats, 'highestCheckout',
    function(v) { return 'Checked out on ' + v; });
}

async function refresh() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const stats = data.stats || [];

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
        '<td class="' + z + '">' + (p.oneEighties || 0) + '</td>' +
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
