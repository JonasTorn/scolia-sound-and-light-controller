import { Logger } from "./utils/Logger";
import { ConfigManager } from "./core/ConfigManager";
import { GameState } from "./core/GameState";
import { EventOrchestrator } from "./core/EventOrchestrator";
import { SoundController } from "./controllers/SoundController";
import { ScoliaThrowPayload } from "./types/index";

// No-op stubs for hardware controllers
const noopLightshark = { triggerExecutor: async () => {} };
const noopKnx = { triggerAction: async () => {} };

// Each sequence represents one "turn" — throws are processed in order,
// then takeout fires to reset state before the next sequence.
const sequences: Array<{ name: string; throws: string[] }> = [
	{ name: "Miss",                throws: ["None"] },
	{ name: "Single 14",           throws: ["s14"] },
	{ name: "Double 20",           throws: ["d20"] },
	{ name: "Triple 19",           throws: ["t19"] },
	{ name: "Triple 20",           throws: ["t20"] },
	{ name: "Bullseye",            throws: ["50"] },
	{ name: "180 (3x T20)",        throws: ["t20", "t20", "t20"] },
	{ name: "120 (2x T20)",        throws: ["t20", "t20"] },
	{ name: "1-2-3",               throws: ["s1", "s2", "s3"] },
	{ name: "3x ones",             throws: ["s1", "s1", "s1"] },
	{ name: "007",                 throws: ["None", "None", "s7"] },
	{ name: "69 (consecutive)",    throws: ["s6", "s9"] },
	{ name: "69 (sum)",            throws: ["s20", "s20", "s29"] },  // 69 total — won't exist but tests sum
	{ name: "3 misses",            throws: ["None", "None", "None"] },
	{ name: "404",                 throws: ["s4", "None", "s4"] },
	{ name: "420",                 throws: ["s4", "s20"] },
	{ name: "1337",                throws: ["s13", "s3", "s7"] },
	{ name: "Bust",                throws: ["bust"] },
	{ name: "Leg won",             throws: ["leg_won"] },
];

function makePayload(sector: string): ScoliaThrowPayload {
	return { sector, coordinates: [50, 50], bounceout: false };
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function runSimulator(): Promise<void> {
	const logger = new Logger({ enabled: true, consoleOutput: true });

	logger.info("========================================");
	logger.info("Scolia Light Controller - Simulator");
	logger.info("========================================");

	try {
		const config = new ConfigManager().load();
		// Force sound on so we can hear it; disable hardware
		config.lightshark.enabled = false;
		config.knx.enabled = false;
		config.sound.enabled = true;

		const gameState = new GameState();
		const soundController = new SoundController(config.sound, logger);

		const orchestrator = new EventOrchestrator(
			gameState,
			config,
			logger,
			noopLightshark,
			soundController,
			noopKnx,
		);

		for (const seq of sequences) {
			logger.info(`\n--- ${seq.name} ---`);

			for (const sector of seq.throws) {
				if (sector === "bust") {
					await orchestrator.handleBustDetected();
				} else if (sector === "leg_won") {
					await orchestrator.handleLegWon();
				} else if (sector === "set_won") {
					await orchestrator.handleSetWon();
				} else {
					await orchestrator.handleThrowDetected(makePayload(sector));
				}
				await delay(300);
			}

			// Reset state between sequences (simulates player removing darts)
			await orchestrator.handleTakeoutFinished();
			await delay(600);
		}

		logger.success("\nSimulator complete ✓");
		// Give sounds a moment to finish before closing
		await delay(1500);
		soundController.close();
		logger.close();
	} catch (err) {
		console.error("Simulator failed:", err);
		process.exit(1);
	}
}

runSimulator().catch((err) => {
	console.error("Simulator error:", err);
	process.exit(1);
});
