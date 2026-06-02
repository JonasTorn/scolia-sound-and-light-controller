import { Logger } from "./utils/Logger";
import { ConfigManager } from "./core/ConfigManager";
import { GameState } from "./core/GameState";
import { EffectResolver } from "./core/EffectResolver";
import { SectorParser } from "./utils/SectorParser";
import { GameThrow } from "./types/index";

const logger = new Logger({ enabled: true, consoleOutput: true });

async function runSimulator(): Promise<void> {
	logger.info("========================================");
	logger.info("Scolia Light Controller - Simulator");
	logger.info("========================================");

	try {
		// Load config
		const configMgr = new ConfigManager();
		const config = configMgr.load();

		// Create game state
		const gameState = new GameState();

		// Create effect resolver
		const effectResolver = new EffectResolver(config.lightshark);

		// Test throws
		const testThrows = [
			{ sector: "s14", description: "Single 14" },
			{ sector: "d20", description: "Double 20" },
			{ sector: "t19", description: "Triple 19" },
			{ sector: "t20", description: "Triple 20 (with strobe)" },
			{ sector: "50", description: "Bullseye 50p (with strobe)" },
			{ sector: "25", description: "Bull 25p" },
			{ sector: "None", description: "Miss" },
		];

		logger.info("Testing throw effect resolution...");

		for (const test of testThrows) {
			const parsed = SectorParser.parse(test.sector);
			const gameThrow: GameThrow = {
				...parsed,
				timestamp: Date.now(),
				playedEvents: {},
			};

			gameState.addThrow(gameThrow);
			const effect = effectResolver.resolve(gameThrow);

			const executor = effect.executor
				? `${effect.executor.page}/${effect.executor.column}/${effect.executor.row}`
				: "none";
			const strobe = effect.hasStrobe
				? ` + STROBE (${effect.strobeDurationMs}ms)`
				: "";

			logger.success(
				`${test.description}: ${gameThrow.points}p [${effect.effectName}] → executor ${executor}${strobe}`,
			);
		}

		logger.info("");
		logger.info("Testing special event detection...");

		const specialThrows = [
			{ throws: [60, 60, 60], description: "180 (3x T20)" },
			{ throws: [60, 60], description: "120 (2x T20)" },
			{ throws: [1, 2, 3], description: "1-2-3" },
			{ throws: [1, 1, 1], description: "3x ones" },
			{ throws: [0, 0, 7], description: "007 (miss, miss, S7)" },
		];

		logger.info("(Simplified test - full detection in real app)");
		for (const test of specialThrows) {
			logger.info(
				`  ${test.description}: Sum = ${test.throws.reduce((a, b) => a + b)}`,
			);
		}

		logger.success("Simulator complete - all systems ready! ✓");
	} catch (err) {
		logger.error("Simulator failed:", err);
		process.exit(1);
	}

	logger.close();
}

runSimulator().catch((err) => {
	console.error("Simulator error:", err);
	process.exit(1);
});
