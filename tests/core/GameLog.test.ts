import { GameLog } from "../../src/core/GameLog";
import * as fs from "fs";
import * as path from "path";

const logger: any = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {}, success: () => {} };

const VIPS = ["Laser", "T10", "Sony", "Luca", "Groggen"];

// Minimal GAME_ENDED_STATISTICS payload, shaped like the real one from Scolia
function statsPayload(opts: {
	id?: string;
	players: string[];
	winner: string;
	guests?: number;
	isAborted?: boolean;
	rounds?: { player: string; sectors: string[] }[];
}): any {
	const idOf = (nick: string) => `id-${nick}`;
	const total = opts.players.length + (opts.guests ?? 0);
	return {
		game: {
			_id: opts.id ?? "game-1",
			isAborted: opts.isAborted ?? false,
			type: "Elimination",
			startTime: "2026-10-01T11:00:20.625Z",
			participants: opts.players.map((p) => ({ _id: idOf(p), nickname: p })),
			playerNumber: total,
			configuration: { playerNr: total },
			winnerIds: [idOf(opts.winner)],
			history: {
				sets: [{ legs: [{ rounds: [(opts.rounds ?? []).map((r) => ({
					userId: idOf(r.player),
					throwTriplet: r.sectors.map((sector) => ({ sector })),
				}))] }] }],
			},
			statistics: opts.players.map((p) => ({
				userId: idOf(p),
				statistics: { eliminations: p === opts.winner ? 2 : 0, eliminated: p === opts.winner ? 0 : 1 },
			})),
		},
	};
}

describe("GameLog", () => {
	const savePath = path.join(__dirname, "test-game-log.json");
	let log: GameLog;

	beforeEach(() => {
		try { fs.unlinkSync(savePath); } catch {}
		log = new GameLog(logger, savePath);
	});

	afterAll(() => {
		try { fs.unlinkSync(savePath); } catch {}
	});

	const statsFor = (nick: string) => log.getPlayerStats(VIPS, 3).find((s) => s.nickname === nick)!;

	it("takes players from the stats payload, not from game start", () => {
		// Game start only resets live tracking — a stale DOM list can't leak in
		log.startGame();
		log.recordGame(statsPayload({ players: ["T10", "Sony", "Luca", "Groggen", "Laser"], winner: "Laser" }));

		expect(statsFor("Laser")).toMatchObject({ gamesPlayed: 1, wins: 1, eliminations: 2 });
		expect(statsFor("Sony")).toMatchObject({ gamesPlayed: 1, wins: 0, eliminated: 1 });
	});

	it("keeps guest games out of VIP stats", () => {
		log.recordGame(statsPayload({ players: ["Laser", "T10", "Sony"], guests: 1, winner: "Laser" }));
		expect(statsFor("Laser").gamesPlayed).toBe(0);
	});

	it("excludes games with fewer than vipMinPlayers", () => {
		log.recordGame(statsPayload({ players: ["Laser", "T10"], winner: "T10" }));
		expect(statsFor("T10").gamesPlayed).toBe(0);
		expect(log.getPlayerStats(VIPS, 2).find((s) => s.nickname === "T10")!.wins).toBe(1);
	});

	it("does not duplicate a game reported twice", () => {
		const payload = statsPayload({ players: ["Laser", "T10", "Sony"], winner: "Sony" });
		log.recordGame(payload);
		log.recordGame(payload);
		expect(statsFor("Sony")).toMatchObject({ gamesPlayed: 1, wins: 1 });
	});

	it("records a game even when game start was never seen (e.g. app restarted mid-game)", () => {
		log.recordGame(statsPayload({ players: ["Laser", "T10", "Sony"], winner: "T10" }));
		expect(statsFor("T10")).toMatchObject({ gamesPlayed: 1, wins: 1, busts: 0 });
	});

	it("does not record aborted games", () => {
		log.recordGame(statsPayload({ players: ["Laser", "T10", "Sony"], winner: "Laser", isAborted: true }));
		expect(statsFor("Laser").gamesPlayed).toBe(0);
	});

	it("adds live-tracked busts to the recorded game, then resets them", () => {
		log.startGame();
		log.recordBust("Luca");
		log.recordBust("Luca");
		log.recordBust("Groggen");
		log.recordGame(statsPayload({ id: "g1", players: ["Laser", "Luca", "Groggen"], winner: "Laser" }));
		log.recordGame(statsPayload({ id: "g2", players: ["Laser", "Luca", "Groggen"], winner: "Laser" }));

		expect(statsFor("Luca").busts).toBe(2);
		expect(statsFor("Groggen").busts).toBe(1);
	});

	it("computes round stats from the throw history", () => {
		log.recordGame(statsPayload({
			players: ["Laser", "T10", "Sony"],
			winner: "Laser",
			rounds: [
				{ player: "Laser", sectors: ["T20", "T20", "T20"] },
				{ player: "T10", sectors: ["T20", "s20", "D10"] },
			],
		}));
		expect(statsFor("Laser")).toMatchObject({ oneEighties: 1, hundredPlus: 1, highestRound: 180 });
		expect(statsFor("T10")).toMatchObject({ oneEighties: 0, hundredPlus: 1, highestRound: 100 });
	});

	it("persists records and loads them back", () => {
		log.recordGame(statsPayload({ players: ["Laser", "T10", "Sony"], winner: "Laser" }));
		const reloaded = new GameLog(logger, savePath);
		expect(reloaded.getPlayerStats(VIPS, 3).find((s) => s.nickname === "Laser")!.wins).toBe(1);
	});

	it("loads existing records in the old format unchanged", () => {
		fs.writeFileSync(savePath, JSON.stringify([{
			id: "old", timestamp: 1790000000000, date: "2026-09-21", gameMode: "Elimination",
			players: ["Laser", "T10", "Sony"], winner: "Sony",
			perPlayer: { Sony: { eliminations: 1, eliminated: 0, oneEighties: 0, hundredPlus: 2, highestRound: 120, busts: 1 } },
		}]));
		const reloaded = new GameLog(logger, savePath);
		expect(reloaded.getPlayerStats(VIPS, 3).find((s) => s.nickname === "Sony")).toMatchObject({ wins: 1, busts: 1, highestRound: 120 });
	});
});
