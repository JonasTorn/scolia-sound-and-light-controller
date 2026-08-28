import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

interface HistoryPerPlayer {
	won: boolean;
	oneEighties: number;
	highestCheckout: number;
	eliminations: number;
	eliminated: number;
	hundredPlus: number;
	highestRound: number;
}

interface HistoryGame {
	_id: string;
	type: string;
	startTime: string;
	players: string[];
	perPlayer: Record<string, HistoryPerPlayer>;
}

interface HistoryFile {
	fetchedAt: string;
	boardId: string;
	boardName: string;
	games: HistoryGame[];
}

const HISTORY_PATH = path.resolve(__dirname, "..", "..", "data", "scolia-history.json");

export class HistoryStore {
	private data: HistoryFile | null = null;

	constructor(private logger: Logger) {
		this.load();
	}

	get available(): boolean {
		return this.data !== null && this.data.games.length > 0;
	}

	// Timestamp of the export — GameLog should only count games after this
	// to avoid double-counting games that appear in both sources.
	get fetchedAtMs(): number {
		return this.data ? new Date(this.data.fetchedAt).getTime() : 0;
	}

	getPlayerStats(vipPlayers: string[], vipMinPlayers: number, seasonStartDate: string): PlayerStats[] {
		if (!this.data) return this.emptyStats(vipPlayers);

		const seasonStart = new Date(seasonStartDate).getTime();

		const qualifying = this.data.games.filter((g) => {
			if (new Date(g.startTime).getTime() < seasonStart) return false;
			return (
				g.players.every((p) => vipPlayers.includes(p)) &&
				g.players.length >= vipMinPlayers
			);
		});

		this.logger.info(
			`HistoryStore: ${qualifying.length}/${this.data.games.length} games qualify ` +
			`(≥${vipMinPlayers} VIP players, since ${seasonStartDate})`,
		);

		return vipPlayers.map((nick) => {
			const myGames = qualifying.filter((g) => g.players.includes(nick));
			let wins = 0;
			let oneEighties = 0;
			let highestCheckout = 0;
			let eliminations = 0;
			let eliminated = 0;
			let hundredPlus = 0;
			let highestRound = 0;

			for (const g of myGames) {
				const pp = g.perPlayer[nick];
				if (!pp) continue;
				if (pp.won) wins++;
				oneEighties += pp.oneEighties;
				if (pp.highestCheckout > highestCheckout) highestCheckout = pp.highestCheckout;
				eliminations += pp.eliminations ?? 0;
				eliminated += pp.eliminated ?? 0;
				hundredPlus += pp.hundredPlus ?? 0;
				if ((pp.highestRound ?? 0) > highestRound) highestRound = pp.highestRound ?? 0;
			}

			const gamesPlayed = myGames.length;
			return {
				nickname: nick,
				gamesPlayed,
				wins,
				winPct: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
				eliminations,
				eliminated,
				oneEighties,
				hundredPlus,
				highestRound,
				busts: 0,
				highestCheckout,
			};
		});
	}

	private load(): void {
		try {
			if (fs.existsSync(HISTORY_PATH)) {
				const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")) as HistoryFile;
				this.data = raw;
				this.logger.info(
					`HistoryStore: loaded ${raw.games.length} games (exported ${raw.fetchedAt})`,
				);
			} else {
				this.logger.info("HistoryStore: no data/scolia-history.json found — historical stats unavailable");
			}
		} catch (err) {
			this.logger.warn(`HistoryStore: failed to load: ${err}`);
		}
	}

	private emptyStats(players: string[]): PlayerStats[] {
		return players.map((nickname) => ({
			nickname,
			gamesPlayed: 0,
			wins: 0,
			winPct: 0,
			eliminations: 0,
			eliminated: 0,
			oneEighties: 0,
			hundredPlus: 0,
			highestRound: 0,
			busts: 0,
			highestCheckout: 0,
		}));
	}
}
