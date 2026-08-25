import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

export type NewPageFn = () => Promise<import("playwright").Page | null>;

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

		const allGames: unknown[] = [];
		try {
			// Navigate to /history to activate auth cookies for same-origin API calls
			await page.goto(`${this.baseUrl}/history`, {
				waitUntil: "domcontentloaded",
				timeout: 20000,
			}).catch((err: unknown) => {
				this.logger.warn(`Scoreboard: /history navigation: ${err}`);
			});

			// Fetch all finished games via direct API call — no date filter = all-time stats
			const LIMIT = 50;
			let offset = 0;
			let totalCount = Infinity;

			while (offset < Math.min(totalCount, 500)) {
				const qs = [
					...Array.from({ length: 8 }, (_, i) => `numberOfPlayers[${i}]=${i + 1}`),
					`offset=${offset}`,
					`limit=${LIMIT}`,
					`outcome=Finished`,
				].join("&");

				const result = await page.evaluate(async (apiUrl: string) => {
					try {
						const res = await fetch(apiUrl, { credentials: "include" });
						if (!res.ok) return null;
						return res.json();
					} catch {
						return null;
					}
				}, `/api/games?${qs}`) as Record<string, unknown> | null;

				if (!result) {
					this.logger.warn(`Scoreboard: /api/games returned null at offset ${offset}`);
					break;
				}

				const batch = Array.isArray(result["data"]) ? (result["data"] as unknown[]) : [];
				if (batch.length === 0) break;

				if (!isFinite(totalCount)) {
					totalCount = Number(result["count"] ?? 0) || Infinity;
					this.logger.info(`Scoreboard: API reports ${totalCount} total finished games`);
				}

				if (this.discoverMode && offset === 0) {
					this.logger.info(
						`Scoreboard: [discovery] first game object: ${JSON.stringify(batch[0]).slice(0, 4000)}`,
					);
				}

				allGames.push(...batch);
				offset += batch.length;
			}
		} catch (err) {
			this.logger.warn(`Scoreboard: API fetch error: ${err}`);
		} finally {
			await page.close().catch(() => {});
		}

		if (allGames.length === 0) {
			this.logger.warn("Scoreboard: No games returned from /api/games");
			return this.emptyStats(vipPlayers);
		}

		this.logger.info(`Scoreboard: Fetched ${allGames.length} total finished games`);
		return this.aggregateStats(allGames, vipPlayers);
	}

	private aggregateStats(games: unknown[], vipPlayers: string[]): PlayerStats[] {
		const validModes = ["x01", "elimination"];

		const filtered = (games as Record<string, unknown>[]).filter((game) => {
			// Scolia uses game.type = "X01" | "Elimination" | etc.
			const mode = String(game["type"] ?? game["gameType"] ?? game["mode"] ?? "").toLowerCase();
			if (!validModes.some((m) => mode.includes(m))) return false;

			const gamePlayers = this.getPlayerList(game);
			const vipCount = gamePlayers.filter((n) => vipPlayers.includes(n)).length;
			return vipCount >= this.vipMinPlayers;
		});

		this.logger.info(
			`Scoreboard: ${filtered.length}/${games.length} games passed filter ` +
			`(≥${this.vipMinPlayers} VIP players, X01/Elimination)`,
		);

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

		let discoveryLogged = false;

		for (const game of filtered as Record<string, unknown>[]) {
			const players = (
				game["players"] ?? game["participants"] ?? game["playerResults"] ?? []
			) as Record<string, unknown>[];

			for (const p of players) {
				const nick = String(
					p["nickname"] ?? p["name"] ?? p["username"] ?? p["playerName"] ?? "",
				);
				if (!nick || !acc.has(nick)) continue;

				// Log first matching player object to reveal actual field names
				if (this.discoverMode && !discoveryLogged) {
					this.logger.info(
						`Scoreboard: [discovery] player object for "${nick}": ${JSON.stringify(p)}`,
					);
					discoveryLogged = true;
				}

				const s = acc.get(nick)!;
				s.gamesPlayed++;

				// Win detection — try common Scolia field shapes
				const won = p["won"] ?? p["winner"] ?? p["isWinner"] ?? p["win"];
				if (won === true || won === 1 || won === "true" || won === "won") s.wins++;

				// Stats — check both flat fields and statistics/stats sub-object
				const sub = (
					typeof p["statistics"] === "object" && p["statistics"] !== null ? p["statistics"]
					: typeof p["stats"] === "object" && p["stats"] !== null ? p["stats"]
					: {}
				) as Record<string, unknown>;

				s.oneEighties += Number(
					p["oneEighties"] ?? p["180s"] ?? p["oneEighty"] ?? p["scores180"] ??
					sub["oneEighties"] ?? sub["180s"] ?? sub["oneEighty"] ?? sub["scores180"] ?? 0,
				);
				s.eliminations += Number(
					p["eliminations"] ?? p["eliminationCount"] ?? p["timesEliminated"] ??
					sub["eliminations"] ?? sub["eliminationCount"] ?? sub["timesEliminated"] ?? 0,
				);
				s.busts += Number(
					p["busts"] ?? p["bustCount"] ?? p["bust"] ??
					sub["busts"] ?? sub["bustCount"] ?? sub["bust"] ?? 0,
				);
				const checkout = Number(
					p["highestCheckout"] ?? p["checkout"] ?? p["bestCheckout"] ?? p["highCheckout"] ??
					sub["highestCheckout"] ?? sub["checkout"] ?? sub["bestCheckout"] ??
					sub["highFinish"] ?? sub["highCheckout"] ?? 0,
				);
				if (checkout > s.highestCheckout) s.highestCheckout = checkout;
			}
		}

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

	private getPlayerList(game: Record<string, unknown>): string[] {
		const players = (
			game["players"] ?? game["participants"] ?? game["playerResults"] ?? []
		) as Record<string, unknown>[];
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
