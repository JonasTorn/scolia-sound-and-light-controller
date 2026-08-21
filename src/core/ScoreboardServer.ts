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
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 60px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 48px;
  }

  h1 {
    font-size: 5rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f5c518;
    text-shadow: 0 0 60px rgba(245, 197, 24, 0.3);
  }

  table {
    width: 100%;
    max-width: 1100px;
    border-collapse: collapse;
  }

  thead th {
    padding: 12px 28px;
    text-align: center;
    color: #666;
    font-weight: 600;
    font-size: 1.2rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    border-bottom: 2px solid #222;
  }

  thead th:nth-child(2) { text-align: left; }

  tbody tr {
    border-bottom: 1px solid #1a1a1a;
    transition: background 0.15s;
  }

  tbody tr:hover { background: #161616; }

  tbody td {
    padding: 22px 28px;
    text-align: center;
    font-size: 2rem;
  }

  tbody td:nth-child(2) {
    text-align: left;
    font-weight: 700;
    font-size: 2.2rem;
  }

  .rank { font-size: 1.6rem; color: #444; min-width: 48px; }
  .rank-1 { color: #FFD700; font-weight: 800; }
  .rank-2 { color: #C0C0C0; font-weight: 800; }
  .rank-3 { color: #CD7F32; font-weight: 800; }

  .win-pct {
    font-weight: 800;
    font-size: 2.4rem;
    color: #f5c518;
  }

  .zero { color: #383838; }

  .no-data {
    color: #333;
    font-size: 2rem;
    text-align: center;
    padding: 60px 0;
  }

  footer {
    position: fixed;
    bottom: 20px;
    right: 28px;
    color: #282828;
    font-size: 0.95rem;
  }
</style>
</head>
<body>

<header>
  <h1>🎯 Scoreboard</h1>
</header>

<table id="table">
  <thead>
    <tr>
      <th>#</th>
      <th>Player</th>
      <th>Games</th>
      <th>Wins</th>
      <th>Win %</th>
      <th>Elim.</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>

<p class="no-data" id="no-data" style="display:none">
  No stats yet — play some games first!
</p>

<footer id="footer"></footer>

<script>
async function refresh() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const stats = data.stats || [];
    const tbody = document.getElementById('tbody');
    const noData = document.getElementById('no-data');
    const table = document.getElementById('table');

    const hasData = stats.some(p => p.gamesPlayed > 0);

    if (!hasData) {
      table.style.display = stats.length ? '' : 'none';
      noData.style.display = stats.length ? 'none' : 'block';
    } else {
      table.style.display = '';
      noData.style.display = 'none';
    }

    // Sort by win%, then by wins as tiebreaker
    stats.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins);

    const medals = ['🥇', '🥈', '🥉'];
    tbody.innerHTML = stats.map((p, i) => {
      const rankClass = i < 3 ? ' rank-' + (i + 1) : '';
      const medal = i < 3 ? medals[i] : (i + 1);
      const winPctStr = p.gamesPlayed > 0 ? p.winPct.toFixed(0) + '%' : '—';
      const zeroClass = p.gamesPlayed === 0 ? ' zero' : '';
      return \`<tr>
        <td class="rank\${rankClass}">\${medal}</td>
        <td>\${p.nickname}</td>
        <td class="\${zeroClass}">\${p.gamesPlayed}</td>
        <td class="\${zeroClass}">\${p.wins}</td>
        <td class="win-pct\${zeroClass}">\${winPctStr}</td>
        <td class="\${zeroClass}">\${p.eliminations}</td>
      </tr>\`;
    }).join('');

    const ts = data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : 'never';
    document.getElementById('footer').textContent = 'Updated ' + ts;
  } catch(e) {
    console.error('Failed to fetch stats:', e);
  }
}

refresh();
setInterval(refresh, 60000);
</script>
</body>
</html>`;
	}
}
