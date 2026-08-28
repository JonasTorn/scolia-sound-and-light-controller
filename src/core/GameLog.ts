import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

interface PerPlayerAccum {
	eliminations: number;
	eliminated: number;
	oneEighties: number;
	busts: number;
	eliminatedThisGame: boolean; // dedup flag — reset on startGame
}

interface GameRecord {
	id: string;
	timestamp: number;
	gameMode: string | null;
	players: string[];
	winner: string | null;
	perPlayer: Record<string, { eliminations: number; eliminated: number; oneEighties: number; busts: number }>;
}

interface ActiveGame {
	id: string;
	timestamp: number;
	gameMode: string | null;
	players: string[];
	perPlayer: Record<string, PerPlayerAccum>;
}

const MAX_RECORDS = 1000;
const SAVE_PATH = path.resolve(__dirname, "..", "..", "data", "game-log.json");

export class GameLog {
	private records: GameRecord[] = [];
	private active: ActiveGame | null = null;

	constructor(private logger: Logger) {
		this.load();
	}

	startGame(players: string[], gameMode: string | null): void {
		// Deduplicate: two game-started events sometimes fire <1s apart for the same game
		if (this.active) {
			const sameGame =
				Date.now() - this.active.timestamp < 1000 &&
				players.length === this.active.players.length &&
				players.every((p) => this.active!.players.includes(p));
			if (sameGame) {
				this.logger.debug("GameLog: duplicate game-started ignored");
				return;
			}
			this.endGame(null); // abandon any in-progress game
		}
		const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
		this.active = {
			id,
			timestamp: Date.now(),
			gameMode,
			players,
			perPlayer: Object.fromEntries(
				players.map((p) => [p, { eliminations: 0, eliminated: 0, oneEighties: 0, busts: 0, eliminatedThisGame: false }]),
			),
		};
		this.logger.info(`GameLog: started (${players.join(", ")}, mode: ${gameMode ?? "unknown"})`);
	}

	recordOneEighty(player: string): void {
		if (!this.active?.perPlayer[player]) return;
		this.active.perPlayer[player].oneEighties++;
	}

	recordBust(player: string): void {
		if (!this.active?.perPlayer[player]) return;
		this.active.perPlayer[player].busts++;
	}

	recordElimination(player: string): void {
		const pp = this.active?.perPlayer[player];
		if (!pp || pp.eliminatedThisGame) return;
		pp.eliminated++;
		pp.eliminatedThisGame = true;
	}

	endGame(winner: string | null): void {
		if (!this.active) return;
		const record: GameRecord = {
			id: this.active.id,
			timestamp: this.active.timestamp,
			gameMode: this.active.gameMode,
			players: this.active.players,
			winner,
			perPlayer: Object.fromEntries(
				Object.entries(this.active.perPlayer).map(([p, v]) => [
					p,
					{ eliminations: v.eliminations, eliminated: v.eliminated, oneEighties: v.oneEighties, busts: v.busts },
				]),
			),
		};
		this.records.push(record);
		if (this.records.length > MAX_RECORDS) this.records = this.records.slice(-MAX_RECORDS);
		this.logger.info(`GameLog: ended, winner: ${winner ?? "none"} (${this.records.length} records total)`);
		this.active = null;
		this.save();
	}

	// Returns aggregated stats for the given VIP players.
	// Only games with >= vipMinPlayers VIP participants count.
	// afterMs: if > 0, only count games that started AFTER this timestamp (to avoid
	// double-counting with HistoryStore when a history export has been loaded).
	getPlayerStats(vipPlayers: string[], vipMinPlayers: number, afterMs = 0): PlayerStats[] {
		const qualifying = this.records.filter(
			(r) =>
				r.winner !== null &&
				r.players.every((p) => vipPlayers.includes(p)) &&
				r.players.length >= vipMinPlayers &&
				(afterMs === 0 || r.timestamp > afterMs),
		);
		return vipPlayers.map((nick) => {
			const myGames = qualifying.filter((r) => r.players.includes(nick));
			const wins = myGames.filter((r) => r.winner === nick).length;
			const gamesPlayed = myGames.length;
			const eliminations = myGames.reduce((s, r) => s + (r.perPlayer[nick]?.eliminations ?? 0), 0);
			const eliminated = myGames.reduce((s, r) => s + (r.perPlayer[nick]?.eliminated ?? 0), 0);
			const oneEighties = myGames.reduce((s, r) => s + (r.perPlayer[nick]?.oneEighties ?? 0), 0);
			const busts = myGames.reduce((s, r) => s + (r.perPlayer[nick]?.busts ?? 0), 0);
			return {
				nickname: nick,
				gamesPlayed,
				wins,
				winPct: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
				eliminations,
				eliminated,
				oneEighties,
				busts,
				highestCheckout: 0,
			};
		});
	}

	private load(): void {
		try {
			if (fs.existsSync(SAVE_PATH)) {
				const raw = JSON.parse(fs.readFileSync(SAVE_PATH, "utf8"));
				this.records = Array.isArray(raw) ? raw : [];
				this.logger.info(`GameLog: loaded ${this.records.length} records from disk`);
			}
		} catch (err) {
			this.logger.warn(`GameLog: failed to load ${SAVE_PATH}: ${err}`);
		}
	}

	private save(): void {
		try {
			fs.writeFileSync(SAVE_PATH, JSON.stringify(this.records, null, 2), "utf8");
		} catch (err) {
			this.logger.warn(`GameLog: failed to save: ${err}`);
		}
	}
}
