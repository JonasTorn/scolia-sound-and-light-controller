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

	async scrape(newPage: NewPageFn, vipPlayers: string[]): Promise<PlayerStats[] | null> {
		const page = await newPage();
		if (!page) {
			this.logger.warn("Scoreboard: Could not open page for history scraping");
			return null;
		}

		const allGames: unknown[] = [];
		try {
			// Navigate to /history and wait for network idle so the SPA has time to
			// silently refresh the auth token before we make our API calls.
			await page.goto(`${this.baseUrl}/history`, {
				waitUntil: "networkidle",
				timeout: 30000,
			}).catch((err: unknown) => {
				this.logger.warn(`Scoreboard: /history navigation: ${err}`);
			});

			// Fetch all finished games via direct API call.
			// startDate=2020-01-01 ensures all-time history (without it the API defaults to a narrow window).
			const LIMIT = 50;
			let offset = 0;
			let totalCount = Infinity;

			while (offset < Math.min(totalCount, 1000)) {
				const qs = [
					...Array.from({ length: 8 }, (_, i) => `numberOfPlayers[${i}]=${i + 1}`),
					`offset=${offset}`,
					`limit=${LIMIT}`,
					`outcome=Finished`,
					`startDate=2020-01-01`,
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

				allGames.push(...batch);
				offset += batch.length;
			}

			// In discover mode, fetch one game detail to reveal per-player stats structure
			if (this.discoverMode && allGames.length > 0) {
				const firstGame = allGames[0] as Record<string, unknown>;
				const gameId = String(firstGame["gameId"] ?? firstGame["_id"] ?? "");
				if (gameId) {
					const detail = await page.evaluate(async (url: string) => {
						try {
							const res = await fetch(url, { credentials: "include" });
							if (!res.ok) return { error: res.status };
							return res.json();
						} catch {
							return null;
						}
					}, `/api/games/${gameId}`) as unknown;
					this.logger.info(
						`Scoreboard: [discovery] game detail /api/games/${gameId}: ${JSON.stringify(detail).slice(0, 5000)}`,
					);
				}
			}
		} catch (err) {
			this.logger.warn(`Scoreboard: API fetch error: ${err}`);
		} finally {
			await page.close().catch(() => {});
		}

		if (allGames.length === 0) {
			this.logger.warn("Scoreboard: No games returned from /api/games — returning null for retry");
			return null;
		}

		this.logger.info(`Scoreboard: Fetched ${allGames.length} total finished games`);
		return this.aggregateStats(allGames, vipPlayers);
	}

	private async fetchGameDetail(
		page: import("playwright").Page,
		gameId: string,
	): Promise<Record<string, unknown> | null> {
		return page.evaluate(async (url: string) => {
			try {
				const res = await fetch(url, { credentials: "include" });
				if (!res.ok) return null;
				return res.json();
			} catch {
				return null;
			}
		}, `/api/games/${gameId}`) as Promise<Record<string, unknown> | null>;
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

		for (const game of filtered as Record<string, unknown>[]) {
			// Wins: game.winnerIds is an array of player _id strings
			const winnerIds = Array.isArray(game["winnerIds"])
				? (game["winnerIds"] as string[])
				: [];

			// Players list in summary: { type, name, _id } — no per-player stats here
			const players = (
				game["players"] ?? game["participants"] ?? game["playerResults"] ?? []
			) as Record<string, unknown>[];

			for (const p of players) {
				// Scolia uses 'name' in the games list
				const nick = String(p["name"] ?? p["nickname"] ?? p["username"] ?? "");
				if (!nick || !acc.has(nick)) continue;

				const s = acc.get(nick)!;
				s.gamesPlayed++;

				// Win: player._id must be in game.winnerIds
				const playerId = String(p["_id"] ?? p["id"] ?? "");
				if (playerId && winnerIds.includes(playerId)) s.wins++;

				// Per-player stats (eliminations, 180s, checkouts) require /api/games/{gameId} detail calls.
				// discoverMode logs the detail structure of the first game — use that to implement below.
			}
		}

		for (const s of acc.values()) {
			s.winPct = s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
		}

		const result = [...acc.values()];
		result.forEach((s) =>
			this.logger.info(
				`Scoreboard: ${s.nickname} — ${s.gamesPlayed} games, ${s.wins} wins (${s.winPct}%)`,
			),
		);
		return result;
	}

	private getPlayerList(game: Record<string, unknown>): string[] {
		const players = (
			game["players"] ?? game["participants"] ?? game["playerResults"] ?? []
		) as Record<string, unknown>[];
		return players
			.map((p) => String(p["name"] ?? p["nickname"] ?? p["username"] ?? p["playerName"] ?? ""))
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
