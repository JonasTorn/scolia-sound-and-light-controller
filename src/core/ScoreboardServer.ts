import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

const HTML_PATH = path.resolve(__dirname, "..", "..", "public", "scoreboard.html");

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
				res.end(fs.readFileSync(HTML_PATH, "utf8"));
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

}
