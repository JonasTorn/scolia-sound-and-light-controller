/**
 * Interactive simulator — type throw codes, hear sounds, see effects.
 * No hardware needed. Run with: npm run sim
 */
import * as readline from "readline";
import { Logger } from "./utils/Logger";
import { ConfigManager } from "./core/ConfigManager";
import { GameState } from "./core/GameState";
import { EventOrchestrator } from "./core/EventOrchestrator";
import { SoundController } from "./controllers/SoundController";

const logger = new Logger({ enabled: true, consoleOutput: true });

// Stub controllers that just log instead of sending to hardware
const stubLightShark = {
	triggerExecutor: (executor: { page: number; column: number; row: number }) =>
		logger.info(`  💡 LightShark → executor ${executor.page}/${executor.column}/${executor.row}`),
	testConnection: async () => true,
	close: () => {},
};
const stubKnx = {
	connect: async () => true,
	triggerAction: (name: string) => logger.info(`  🔌 KNX → ${name}`),
	disconnect: () => {},
};

const HELP = `
Throw codes:
  s<n>   single    e.g. s20  s1  s14
  d<n>   double    e.g. d20  d6
  t<n>   triple    e.g. t20  t19  t18
  25     bull 25p
  50     bullseye
  None   miss (bounceout = false)

Commands:
  takeout   simulate takeout (pilar tas ut)
  bust      simulate bust
  leg       simulate leg won
  set       simulate set won
  reset     reset throw history
  q / quit  exit
`;

async function main() {
	const configMgr = new ConfigManager();
	const config = configMgr.load();

	const gameState = new GameState();
	const soundController = new SoundController(config.sound, logger);

	const orchestrator = new EventOrchestrator(
		gameState,
		config,
		logger,
		stubLightShark,
		soundController,
		stubKnx,
	);

	console.log("\n=== Scolia Interactive Simulator ===");
	console.log(HELP);
	console.log('Type a throw code and press Enter. Type "help" for the list.\n');

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: "throw> ",
	});

	rl.prompt();

	rl.on("line", async (line) => {
		const input = line.trim().toLowerCase();
		if (!input) {
			rl.prompt();
			return;
		}

		if (input === "q" || input === "quit") {
			soundController.close();
			process.exit(0);
		}

		if (input === "help") {
			console.log(HELP);
			rl.prompt();
			return;
		}

		if (input === "reset") {
			gameState.reset();
			logger.info("Throw history reset.");
			rl.prompt();
			return;
		}

		if (input === "takeout") {
			logger.info("→ TAKEOUT_FINISHED");
			await orchestrator.handleTakeoutFinished();
			rl.prompt();
			return;
		}

		if (input === "bust") {
			logger.info("→ BUST detected");
			await soundController.playSound("bust");
			rl.prompt();
			return;
		}

		if (input === "leg") {
			logger.info("→ LEG WON");
			await soundController.playSound("leg_won");
			rl.prompt();
			return;
		}

		if (input === "set") {
			logger.info("→ SET WON");
			await soundController.playSound("set_won");
			rl.prompt();
			return;
		}

		// Treat input as a sector code
		const sector = input === "none" ? "None" : input.toUpperCase().replace(/^([SDT])/, (m) => m.toLowerCase()) || input;
		const normalizedSector = normalizeSector(line.trim());

		logger.info(`→ THROW_DETECTED sector="${normalizedSector}"`);
		await orchestrator.handleThrowDetected({
			sector: normalizedSector,
			coordinates: [0, 0],
			bounceout: false,
		});

		rl.prompt();
	});

	rl.on("close", () => {
		soundController.close();
		process.exit(0);
	});
}

function normalizeSector(raw: string): string {
	const lower = raw.toLowerCase();
	if (lower === "none") return "None";
	if (lower === "25") return "25";
	if (lower === "50") return "50";
	// s14 → s14, d20 → d20, t19 → t19
	const match = lower.match(/^([sdt])(\d+)$/);
	if (match) return match[1] + match[2];
	return raw;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
