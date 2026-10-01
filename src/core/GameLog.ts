import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

interface PerPlayerStats {
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
	perPlayer: Record<string, PerPlayerStats>;
}

const MAX_RECORDS = 1000;
const SAVE_PATH = path.resolve(__dirname, "..", "..", "data", "game-log.json");

// Game records are built entirely from Scolia's GAME_ENDED_STATISTICS payload —
// the authoritative source for players, winner and per-player stats. The only
// thing tracked live is busts, which Scolia doesn't report.
export class GameLog {
	private records: GameRecord[] = [];
	private liveBusts: Record<string, number> = {};

	constructor(
		private logger: Logger,
		private savePath = SAVE_PATH,
	) {
		this.load();
	}

	// Resets live bust tracking for a new game. Player names are not stored —
	// at game start they can still be the previous game's.
	startGame(): void {
		this.liveBusts = {};
	}

	recordBust(player: string): void {
		this.liveBusts[player] = (this.liveBusts[player] ?? 0) + 1;
	}

	// Called when API::GAME::GAME_ENDED_STATISTICS arrives via WS proxy.
	recordGame(payload: any): void {
		const game = payload?.game ?? payload;
		if (!game?._id) {
			this.logger.warn("GameLog: GAME_ENDED_STATISTICS without game id — not recorded");
			return;
		}
		if (game.isAborted) {
			this.logger.info(`GameLog: game ${game._id} was aborted — not recorded`);
			this.liveBusts = {};
			return;
		}

		const scoliaId: string = game._id;
		const idToNick: Record<string, string> = {};
		for (const p of game.participants ?? []) {
			if (p._id && p.nickname) idToNick[p._id] = p.nickname;
		}
		const nicks = Object.values(idToNick);

		// Guests have no nickname in participants — add a placeholder per guest so
		// guest games stay excluded from VIP stats.
		const totalPlayers: number = game.playerNumber ?? game.configuration?.playerNr ?? nicks.length;
		const guests = Math.max(0, totalPlayers - nicks.length);
		const players = [...nicks, ...Array.from({ length: guests }, (_, i) => `Guest ${i + 1}`)];

		const winnerIds: string[] = game.winnerIds ?? game.history?.winnerPlayerUserIds ?? [];
		const winner = winnerIds.map((id) => idToNick[id]).filter(Boolean)[0] ?? null;

		const roundStats = this.computeRoundStats(game.history, idToNick);
		const statsByUserId: Record<string, any> = {};
		for (const ps of game.statistics ?? []) {
			if (ps.userId) statsByUserId[ps.userId] = ps.statistics ?? {};
		}

		const perPlayer: Record<string, PerPlayerStats> = {};
		for (const [id, nick] of Object.entries(idToNick)) {
			const st = statsByUserId[id] ?? {};
			const rs = roundStats[id] ?? { oneEighties: 0, hundredPlus: 0, highestRound: 0 };
			perPlayer[nick] = {
				eliminations: st.eliminations ?? 0,
				eliminated:   st.eliminated ?? 0,
				oneEighties:  st["180"] ?? rs.oneEighties,
				hundredPlus:  rs.hundredPlus,
				highestRound: rs.highestRound,
				busts:        this.liveBusts[nick] ?? 0,
			};
		}

		const startMs = Date.parse(game.startTime);
		const timestamp = Number.isFinite(startMs) ? startMs : Date.now();
		const record: GameRecord = {
			id: scoliaId,
			timestamp,
			date: new Date(timestamp).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }),
			gameMode: game.type ?? null,
			players,
			winner,
			scoliaId,
			perPlayer,
		};

		// Same game reported twice — replace instead of duplicating
		const existing = this.records.findIndex((r) => r.scoliaId === scoliaId);
		if (existing >= 0) this.records[existing] = record;
		else this.records.push(record);
		if (this.records.length > MAX_RECORDS) this.records = this.records.slice(-MAX_RECORDS);

		this.liveBusts = {};
		this.logger.info(
			`GameLog: recorded ${record.gameMode ?? "game"} (${players.join(", ")}), winner: ${winner ?? "none"}, scoliaId: ${scoliaId} (${this.records.length} records total)`,
		);
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
			if (fs.existsSync(this.savePath)) {
				const raw = JSON.parse(fs.readFileSync(this.savePath, "utf8"));
				this.records = Array.isArray(raw) ? raw : [];
				this.logger.info(`GameLog: loaded ${this.records.length} records from disk`);
			}
		} catch (err) {
			this.logger.warn(`GameLog: failed to load ${this.savePath}: ${err}`);
		}
	}

	private save(): void {
		try {
			fs.writeFileSync(this.savePath, JSON.stringify(this.records, null, 2), "utf8");
		} catch (err) {
			this.logger.warn(`GameLog: failed to save: ${err}`);
		}
	}
}
