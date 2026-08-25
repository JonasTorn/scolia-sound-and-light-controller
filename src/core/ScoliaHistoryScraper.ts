import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

export type NewPageFn = () => Promise<import("playwright").Page | null>;

interface CapturedResponse {
	url: string;
	body: unknown;
}

export class ScoliaHistoryScraper {
	constructor(
		private logger: Logger,
		private baseUrl: string,
		private vipMinPlayers: number = 3,
		private discoverMode: boolean = false,
	) {}

	async scrape(newPage: NewPageFn, vipPlayers: string[]): Promise<PlayerStats[]> {
		const page = await newPage();
		if (!page) {
			this.logger.warn("Scoreboard: Could not open page for history scraping");
			return this.emptyStats(vipPlayers);
		}

		const captured: CapturedResponse[] = [];

		page.on("response", async (response) => {
			const ct = response.headers()["content-type"] ?? "";
			if (!ct.includes("json")) return;
			const url = response.url();
			// Skip Next.js build manifests and static assets
			if (url.includes("/_next/") || url.includes("/static/") || url.includes("/_buildManifest")) return;
			try {
				const body = await response.json();
				const size = JSON.stringify(body).length;
				if (this.discoverMode) {
					this.logger.info(`Scoreboard: [discovery] ${url} — ${size} bytes`);
					this.logger.info(`Scoreboard: [discovery] body: ${JSON.stringify(body).slice(0, 800)}`);
				} else {
					this.logger.debug(`Scoreboard: [history] ${url} — ${size} bytes`);
				}
				captured.push({ url, body });
			} catch { /* ignore */ }
		});

		try {
			await page.goto(`${this.baseUrl}/history`, {
				waitUntil: "networkidle",
				timeout: 30000,
			});
		} catch (err) {
			this.logger.warn(`Scoreboard: History page load failed: ${err}`);
		} finally {
			await page.close().catch(() => {});
		}

		if (captured.length === 0) {
			this.logger.warn("Scoreboard: No JSON API responses captured from /history — page may require interaction or login");
			return this.emptyStats(vipPlayers);
		}

		this.logger.info(`Scoreboard: Captured ${captured.length} JSON responses from /history`);
		return this.parseResponses(captured, vipPlayers);
	}

	private parseResponses(captured: CapturedResponse[], vipPlayers: string[]): PlayerStats[] {
		// Try each response to find one that looks like a games list
		for (const { url, body } of captured) {
			const games = this.extractGamesArray(body);
			if (games && games.length > 0) {
				this.logger.info(`Scoreboard: Found ${games.length} game records in ${url}`);
				return this.aggregateStats(games, vipPlayers);
			}
		}

		this.logger.warn(
			"Scoreboard: Could not parse game records from /history responses. " +
			"Enable scoreboard.discoverStats in config to log full response bodies.",
		);
		return this.emptyStats(vipPlayers);
	}

	private extractGamesArray(body: unknown): unknown[] | null {
		if (!body || typeof body !== "object") return null;

		// Top-level array
		if (Array.isArray(body) && body.length > 0) return body;

		const obj = body as Record<string, unknown>;

		// Common API wrapper keys
		for (const key of ["games", "matches", "history", "results", "data", "items", "records", "sessions"]) {
			if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0) {
				return obj[key] as unknown[];
			}
		}

		// One level deeper: { data: { games: [...] } }
		if (obj["data"] && typeof obj["data"] === "object" && !Array.isArray(obj["data"])) {
			return this.extractGamesArray(obj["data"]);
		}

		return null;
	}

	private aggregateStats(games: unknown[], vipPlayers: string[]): PlayerStats[] {
		const validModes = ["x01", "elimination"];

		// Filter by game mode and VIP player count
		const filtered = (games as Record<string, unknown>[]).filter((game) => {
			const mode = String(
				game["gameType"] ?? game["mode"] ?? game["type"] ?? game["gameMode"] ?? "",
			).toLowerCase();
			if (!validModes.some((m) => mode.includes(m))) return false;

			const gamePlayers = this.getPlayerList(game);
			const vipCount = gamePlayers.filter((n) => vipPlayers.includes(n)).length;
			return vipCount >= this.vipMinPlayers;
		});

		this.logger.info(
			`Scoreboard: ${filtered.length}/${games.length} games passed filter ` +
			`(≥${this.vipMinPlayers} VIP players, X01/Elimination)`,
		);

		// Build per-player accumulators
		const acc = new Map<string, PlayerStats>();
		for (const nick of vipPlayers) {
			acc.set(nick, {
				nickname: nick,
				gamesPlayed: 0,
				wins: 0,
				winPct: 0,
				eliminations: 0,
				oneEighties: 0,
				busts: 0,
				highestCheckout: 0,
			});
		}

		for (const game of filtered as Record<string, unknown>[]) {
			const players = (game["players"] ?? game["participants"] ?? game["playerResults"] ?? []) as Record<string, unknown>[];
			for (const p of players) {
				const nick = String(p["nickname"] ?? p["name"] ?? p["username"] ?? p["playerName"] ?? "");
				if (!nick || !acc.has(nick)) continue;
				const s = acc.get(nick)!;
				s.gamesPlayed++;

				// Win detection — try multiple field shapes
				const won = p["won"] ?? p["winner"] ?? p["isWinner"] ?? p["win"];
				if (won === true || won === 1 || won === "true") s.wins++;

				// Stat counters — try multiple field names Scolia might use
				s.eliminations += Number(p["eliminations"] ?? p["eliminationCount"] ?? p["timesEliminated"] ?? 0);
				s.oneEighties  += Number(p["oneEighties"] ?? p["180s"] ?? p["oneEighty"] ?? p["scores180"] ?? 0);
				s.busts        += Number(p["busts"] ?? p["bustCount"] ?? p["bust"] ?? 0);

				const checkout = Number(
					p["highestCheckout"] ?? p["checkout"] ?? p["bestCheckout"] ?? p["highCheckout"] ?? 0,
				);
				if (checkout > s.highestCheckout) s.highestCheckout = checkout;
			}
		}

		// Compute win percentages
		for (const s of acc.values()) {
			s.winPct = s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
		}

		const result = [...acc.values()];
		result.forEach((s) =>
			this.logger.info(
				`Scoreboard: ${s.nickname} — ${s.gamesPlayed} games, ${s.wins} wins, ` +
				`${s.eliminations} elim, ${s.oneEighties} 180s, ${s.busts} busts, ` +
				`best checkout ${s.highestCheckout}`,
			),
		);
		return result;
	}

	// Extract player nicknames from a game object (handles different array shapes)
	private getPlayerList(game: Record<string, unknown>): string[] {
		const players = (game["players"] ?? game["participants"] ?? game["playerResults"] ?? []) as Record<string, unknown>[];
		return players
			.map((p) => String(p["nickname"] ?? p["name"] ?? p["username"] ?? p["playerName"] ?? ""))
			.filter(Boolean);
	}

	private emptyStats(players: string[]): PlayerStats[] {
		return players.map((nickname) => ({
			nickname,
			gamesPlayed: 0,
			wins: 0,
			winPct: 0,
			eliminations: 0,
			oneEighties: 0,
			busts: 0,
			highestCheckout: 0,
		}));
	}
}
