import { GameState } from "../../src/core/GameState";
import { GameThrow } from "../../src/types/index";
import * as fs from "fs";
import * as path from "path";

describe("GameState", () => {
	let gameState: GameState;
	const testPersistencePath = path.join(__dirname, "test-state.json");

	beforeEach(() => {
		gameState = new GameState(testPersistencePath);
	});

	afterEach(() => {
		// Clean up test file
		try {
			fs.unlinkSync(testPersistencePath);
		} catch {}
	});

	describe("Throw History", () => {
		it("should add throws to history", () => {
			const throwData = {
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			};

			const result = gameState.addThrow(throwData);
			expect(result.points).toBe(20);
			expect(result.playedEvents).toEqual({});
		});

		it("should retrieve throw history", () => {
			gameState.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			});
			gameState.addThrow({
				points: 60,
				multiplier: 3,
				segment: 20,
				timestamp: Date.now(),
			});

			const history = gameState.getThrowHistory();
			expect(history).toHaveLength(2);
			expect(history[0].points).toBe(20);
			expect(history[1].points).toBe(60);
		});

		it("should get last throw", () => {
			gameState.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			});
			gameState.addThrow({
				points: 60,
				multiplier: 3,
				segment: 20,
				timestamp: Date.now(),
			});

			const lastThrow = gameState.getLastThrow();
			expect(lastThrow?.points).toBe(60);
		});

		it("should return null for last throw on empty history", () => {
			expect(gameState.getLastThrow()).toBeNull();
		});

		it("should get last N throws", () => {
			gameState.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			});
			gameState.addThrow({
				points: 40,
				multiplier: 2,
				segment: 20,
				timestamp: Date.now(),
			});
			gameState.addThrow({
				points: 60,
				multiplier: 3,
				segment: 20,
				timestamp: Date.now(),
			});

			const last2 = gameState.getLastNThrows(2);
			expect(last2).toHaveLength(2);
			expect(last2[0].points).toBe(40);
			expect(last2[1].points).toBe(60);
		});

		it("should bound history to MAX_HISTORY", () => {
			// Add more than 100 throws
			for (let i = 0; i < 150; i++) {
				gameState.addThrow({
					points: i,
					multiplier: 1,
					segment: 1,
					timestamp: Date.now(),
				});
			}

			const history = gameState.getThrowHistory();
			expect(history.length).toBeLessThanOrEqual(100);
			// Should keep the last 100
			expect(history[history.length - 1].points).toBe(149);
		});
	});

	describe("Executor Tracking", () => {
		it("should set and get last executor", () => {
			const executor = { page: 1, column: 2, row: 1 };
			gameState.setLastExecutor(executor);
			expect(gameState.getLastExecutor()).toEqual(executor);
		});

		it("should clear last executor", () => {
			gameState.setLastExecutor({ page: 1, column: 2, row: 1 });
			gameState.setLastExecutor(null);
			expect(gameState.getLastExecutor()).toBeNull();
		});

		it("should manage special executors", () => {
			const ex1 = { page: 1, column: 6, row: 2 };
			const ex2 = { page: 1, column: 7, row: 2 };

			gameState.setSpecialExecutors([ex1, ex2]);
			expect(gameState.getSpecialExecutors()).toEqual([ex1, ex2]);
		});

		it("should add special executor without duplicates", () => {
			const ex1 = { page: 1, column: 6, row: 2 };
			gameState.addSpecialExecutor(ex1);
			gameState.addSpecialExecutor(ex1); // Add same executor again

			expect(gameState.getSpecialExecutors()).toHaveLength(1);
		});

		it("should clear special executors", () => {
			gameState.setSpecialExecutors([{ page: 1, column: 6, row: 2 }]);
			gameState.clearSpecialExecutors();
			expect(gameState.getSpecialExecutors()).toEqual([]);
		});
	});

	describe("KNX State", () => {
		it("should set and get KNX state", () => {
			gameState.setKNXState("off");
			expect(gameState.getKNXState()).toBe("off");

			gameState.setKNXState("on");
			expect(gameState.getKNXState()).toBe("on");
		});

		it("should default to on", () => {
			expect(gameState.getKNXState()).toBe("on");
		});
	});

	describe("Strobe State", () => {
		it("should set and get strobe active state", () => {
			expect(gameState.isStrobeActive()).toBe(false);

			gameState.setStrobeActive(true);
			expect(gameState.isStrobeActive()).toBe(true);

			gameState.setStrobeActive(false);
			expect(gameState.isStrobeActive()).toBe(false);
		});
	});

	describe("Special Event Tracking", () => {
		it("should mark event as played", () => {
			gameState.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			});

			gameState.markEventPlayed(0, "180");
			expect(gameState.isEventPlayed(0, "180")).toBe(true);
		});

		it("should not mark different event as played", () => {
			gameState.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			});

			gameState.markEventPlayed(0, "180");
			expect(gameState.isEventPlayed(0, "120")).toBe(false);
		});

		it("should handle invalid throw indices", () => {
			expect(gameState.isEventPlayed(999, "180")).toBe(false);
		});
	});

	describe("State Reset", () => {
		it("should reset all state", () => {
			gameState.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: Date.now(),
			});
			gameState.setLastExecutor({ page: 1, column: 2, row: 1 });
			gameState.setKNXState("off");
			gameState.setStrobeActive(true);

			gameState.reset();

			expect(gameState.getThrowHistory()).toEqual([]);
			expect(gameState.getLastExecutor()).toBeNull();
			expect(gameState.getKNXState()).toBe("on");
			expect(gameState.isStrobeActive()).toBe(false);
		});
	});

	describe("Serialization", () => {
		it("should serialize state correctly", () => {
			gameState.addThrow({
				points: 60,
				multiplier: 3,
				segment: 20,
				timestamp: Date.now(),
			});
			gameState.setLastExecutor({ page: 1, column: 2, row: 1 });
			gameState.setKNXState("off");

			const snapshot = gameState.serialize();

			expect(snapshot.throwHistory).toHaveLength(1);
			expect(snapshot.lastExecutor).toEqual({ page: 1, column: 2, row: 1 });
			expect(snapshot.knxState).toBe("off");
		});
	});

	describe("Persistence", () => {
		it("should save and load state from disk", () => {
			const gs1 = new GameState(testPersistencePath);
			gs1.addThrow({
				points: 20,
				multiplier: 1,
				segment: 20,
				timestamp: 12345,
			});
			gs1.setKNXState("off");

			// Create new instance, should load persisted state
			const gs2 = new GameState(testPersistencePath);
			expect(gs2.getThrowHistory()).toHaveLength(1);
			expect(gs2.getThrowHistory()[0].points).toBe(20);
			expect(gs2.getKNXState()).toBe("off");
		});

		it("should handle missing persistence file gracefully", () => {
			const gs = new GameState("/nonexistent/path/state.json");
			expect(gs.getThrowHistory()).toEqual([]);
		});
	});
});
