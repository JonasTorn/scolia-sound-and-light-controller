import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

interface PerPlayerAccum {
	eliminations: number;
	eliminated: number;
	oneEighties: number;
	hundredPlus: number;
	highestRound: number;
	busts: number;
}

interface GameRecord {
	id: string;
	timestamp: number;
	date: string;
	gameMode: string | null;
	players: string[];
	winner: string | null;
	scoliaId?: string;
	perPlayer: Record<string, { eliminations: number; eliminated: number; oneEighties: number; hundredPlus: number; highestRound: number; busts: number }>;
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
	private roundPoints = 0;
	private roundPlayer: string | null = null;

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
				players.map((p) => [p, { eliminations: 0, eliminated: 0, oneEighties: 0, hundredPlus: 0, highestRound: 0, busts: 0 }]),
			),
		};
		this.logger.info(`GameLog: started (${players.join(", ")}, mode: ${gameMode ?? "unknown"})`);
	}

	recordThrow(player: string, points: number): void {
		if (this.roundPlayer !== player) {
			this.roundPoints = 0;
			this.roundPlayer = player;
		}
		this.roundPoints += points;
	}

	finalizeRound(): void {
		const pp = this.roundPlayer ? this.active?.perPlayer[this.roundPlayer] : null;
		if (pp && this.roundPoints > 0) {
			if (this.roundPoints >= 100) pp.hundredPlus++;
			if (this.roundPoints > pp.highestRound) pp.highestRound = this.roundPoints;
		}
		this.roundPoints = 0;
		this.roundPlayer = null;
	}

	recordOneEighty(player: string): void {
		if (!this.active?.perPlayer[player]) return;
		this.active.perPlayer[player].oneEighties++;
	}

	recordBust(player: string): void {
		if (!this.active?.perPlayer[player]) return;
		this.active.perPlayer[player].busts++;
	}

	recordElimination(player: string, eliminator?: string): void {
		const pp = this.active?.perPlayer[player];
		if (!pp) return;
		pp.eliminated++;
		if (eliminator && eliminator !== player && this.active?.perPlayer[eliminator]) {
			this.active.perPlayer[eliminator].eliminations++;
		}
	}

	endGame(winner: string | null): void {
		if (!this.active) return;
		this.finalizeRound(); // commit any in-progress round before saving
		const record: GameRecord = {
			id: this.active.id,
			timestamp: this.active.timestamp,
			date: new Date(this.active.timestamp).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }),
			gameMode: this.active.gameMode,
			players: this.active.players,
			winner,
			scoliaId: (this.active as any).scoliaId,
			perPlayer: Object.fromEntries(
				Object.entries(this.active.perPlayer).map(([p, v]) => [
					p,
					{ eliminations: v.eliminations, eliminated: v.eliminated, oneEighties: v.oneEighties, hundredPlus: v.hundredPlus, highestRound: v.highestRound, busts: v.busts },
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
			const hundredPlus = myGames.reduce((s, r) => s + (r.perPlayer[nick]?.hundredPlus ?? 0), 0);
			const highestRound = myGames.reduce((s, r) => Math.max(s, r.perPlayer[nick]?.highestRound ?? 0), 0);
			const busts = myGames.reduce((s, r) => s + (r.perPlayer[nick]?.busts ?? 0), 0);
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
				busts,
				highestCheckout: 0,
			};
		});
	}

	// Called when API::GAME::GAME_ENDED_STATISTICS arrives via WS proxy.
	// Overwrites per-player stats with authoritative Scolia data, preserving
	// busts (which Scolia doesn't report) from the live tracking.
	finalizeFromStats(payload: any): void {
		const game = payload?.game ?? payload;
		if (!game) return;

		const scoliaId: string | undefined = game._id;
		const winnerIds: string[] = game.winnerIds ?? game.history?.winnerPlayerUserIds ?? [];

		const idToNick: Record<string, string> = {};
		for (const p of game.participants ?? []) {
			if (p._id && p.nickname) idToNick[p._id] = p.nickname;
		}

		const winnerNick = winnerIds.map((id: string) => idToNick[id]).filter(Boolean)[0] ?? null;

		const roundStats = this.computeRoundStats(game.history, idToNick);

		const statsByUserId: Record<string, any> = {};
		for (const ps of game.statistics ?? []) {
			if (ps.userId) statsByUserId[ps.userId] = ps.statistics ?? {};
		}

		const buildPerPlayer = (existingBusts: Record<string, number>) => {
			const pp: Record<string, PerPlayerAccum> = {};
			for (const p of game.participants ?? []) {
				const nick = idToNick[p._id];
				if (!nick) continue;
				const st = statsByUserId[p._id] ?? {};
				const rs = roundStats[p._id] ?? { oneEighties: 0, hundredPlus: 0, highestRound: 0 };
				pp[nick] = {
					eliminations: st.eliminations ?? 0,
					eliminated:   st.eliminated ?? 0,
					oneEighties:  st["180"] ?? rs.oneEighties,
					hundredPlus:  rs.hundredPlus,
					highestRound: rs.highestRound,
					busts:        existingBusts[nick] ?? 0,
				};
			}
			return pp;
		};

		if (this.active) {
			// Game not yet saved — override accumulator then let endGame() handle saving
			const busts = Object.fromEntries(
				Object.entries(this.active.perPlayer).map(([n, v]) => [n, v.busts]),
			);
			this.active.perPlayer = buildPerPlayer(busts);
			if (scoliaId) (this.active as any).scoliaId = scoliaId;
			this.endGame(winnerNick);
			return;
		}

		// Game already saved via DOM set-won — patch the last record
		const last = this.records[this.records.length - 1];
		if (!last) return;
		const busts = Object.fromEntries(
			Object.entries(last.perPlayer).map(([n, v]) => [n, v.busts]),
		);
		last.winner = winnerNick;
		last.scoliaId = scoliaId;
		last.perPlayer = buildPerPlayer(busts);
		this.logger.info(`GameLog: finalized from GAME_ENDED_STATISTICS — winner: ${winnerNick ?? "none"}, scoliaId: ${scoliaId}`);
		this.save();
	}

	private computeRoundStats(history: any, idToNick: Record<string, string>): Record<string, { oneEighties: number; hundredPlus: number; highestRound: number }> {
		const result: Record<string, { oneEighties: number; hundredPlus: number; highestRound: number }> = {};
		for (const set of history?.sets ?? []) {
			for (const leg of set.legs ?? []) {
				for (const round of leg.rounds ?? []) {
					for (const visit of round) {
						const userId: string = visit.userId;
						if (!userId || !idToNick[userId]) continue;
						if (!result[userId]) result[userId] = { oneEighties: 0, hundredPlus: 0, highestRound: 0 };
						const score = (visit.throwTriplet ?? []).reduce(
							(s: number, d: any) => s + this.sectorScore(d.sector), 0,
						);
						if (score === 180) result[userId].oneEighties++;
						if (score >= 100) result[userId].hundredPlus++;
						if (score > result[userId].highestRound) result[userId].highestRound = score;
					}
				}
			}
		}
		return result;
	}

	private sectorScore(sector: string): number {
		const s = String(sector ?? "").toUpperCase().trim();
		if (s === "BULL" || s === "50") return 50;
		if (s === "25" || s === "S25") return 25;
		const m = s.match(/^([SDT])(\d+)$/);
		if (!m) return 0;
		const mult: Record<string, number> = { S: 1, D: 2, T: 3 };
		return (mult[m[1]] ?? 0) * parseInt(m[2], 10);
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
