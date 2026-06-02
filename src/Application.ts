import * as WebSocket from "ws";
import { Logger, LoggerConfig } from "./utils/Logger";
import { ConfigManager } from "./core/ConfigManager";
import { GameState } from "./core/GameState";
import { EventOrchestrator } from "./core/EventOrchestrator";
import { LightSharkController } from "./controllers/LightSharkController";
import { SoundController } from "./controllers/SoundController";
import { KNXController } from "./controllers/KNXController";
import { PlaywrightController } from "./controllers/PlaywrightController";
import {
	ScoliaThrowPayload,
	FullConfig,
	ScoliaThrowPayload as ScoliaPayload,
} from "./types/index";

export class Application {
	private logger: Logger;
	private config: FullConfig;
	private gameState: GameState;
	private lightsharkController: LightSharkController;
	private soundController: SoundController;
	private knxController: KNXController;
	private playwrightController: PlaywrightController;
	private eventOrchestrator: EventOrchestrator;
	private ws: WebSocket.WebSocket | null = null;
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private running = false;

	constructor(private configPath?: string) {
		// Initialize config
		const configManager = new ConfigManager(configPath);
		this.config = configManager.load();

		// Initialize logger
		const loggerConfig: LoggerConfig = this.config.logging;
		this.logger = new Logger(loggerConfig);

		// Initialize game state with persistence
		this.gameState = new GameState();

		// Initialize controllers
		this.lightsharkController = new LightSharkController(
			this.config.lightshark,
			this.logger,
		);
		this.soundController = new SoundController(this.config.sound, this.logger);
		this.knxController = new KNXController(this.config.knx, this.logger);
		this.playwrightController = new PlaywrightController(
			this.config.playwright,
			this.logger,
		);

		// Initialize orchestrator (central handler)
		this.eventOrchestrator = new EventOrchestrator(
			this.gameState,
			this.config,
			this.logger,
			this.lightsharkController,
			this.soundController,
			this.knxController,
		);

		// Attach Playwright event listeners for bust/leg-won/set-won
		this.playwrightController.on("bust", () => {
			this.handleBustDetected();
		});

		this.playwrightController.on("leg-won", () => {
			this.handleLegWon();
		});

		this.playwrightController.on("set-won", () => {
			this.handleSetWon();
		});
	}

	async start(): Promise<void> {
		try {
			this.logger.info("========================================");
			this.logger.info("Scolia Light Controller - Starting");
			this.logger.info("========================================");

			this.running = true;

			// 1. Connect to LightShark
			if (this.config.lightshark.enabled) {
				const connected = await this.lightsharkController.testConnection();
				if (connected) {
					this.logger.success("✓ LightShark connected");
				} else {
					this.logger.warn("⚠ LightShark connection failed");
				}
			}

			// 2. Connect to KNX
			if (this.config.knx.enabled) {
				const connected = await this.knxController.connect();
				if (connected) {
					this.logger.success("✓ KNX connected");
				}
			}

			// 3. Launch Playwright
			if (this.config.playwright.enabled) {
				await this.playwrightController.launch();
			}

			// 4. Connect to Scolia WebSocket
			if (!this.config.scolia.simulationMode) {
				this.connectScolia();
			} else {
				this.logger.info("Simulation mode enabled - no Scolia connection");
			}

			// 5. Setup graceful shutdown
			process.on("SIGINT", () => this.shutdown());
			process.on("SIGTERM", () => this.shutdown());

			this.logger.success("Application started");
		} catch (err) {
			this.logger.error("Failed to start application:", err);
			await this.shutdown();
			process.exit(1);
		}
	}

	private connectScolia(): void {
		try {
			this.logger.info(`Connecting to Scolia: ${this.config.scolia.serverUrl}`);

			this.ws = new WebSocket.WebSocket(this.config.scolia.serverUrl);

			this.ws.on("open", () => {
				this.logger.success("✓ Scolia WebSocket connected");
				this.reconnectTimeout = null;

				// Send initial request
				const msg = JSON.stringify({
					type: "GET_SBC_STATUS",
					serialNumber: this.config.scolia.serialNumber,
					accessToken: this.config.scolia.accessToken,
				});
				this.ws!.send(msg);
			});

			this.ws.on("message", (data: WebSocket.RawData) => {
				this.handleScoliaMessage(data.toString());
			});

			this.ws.on("close", () => {
				this.logger.warn("Scolia WebSocket closed");
				this.gameState.reset();
				if (this.running) {
					this.scheduleReconnect();
				}
			});

			this.ws.on("error", (err: Error) => {
				this.logger.error("Scolia WebSocket error:", err.message);
			});
		} catch (err) {
			this.logger.error("Failed to connect to Scolia:", err);
			if (this.running) {
				this.scheduleReconnect();
			}
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimeout) return;

		const delay = this.config.scolia.reconnectDelay;
		const jitter = Math.random() * 2000;
		const totalDelay = delay + jitter;

		this.logger.info(
			`Reconnecting to Scolia in ${Math.round(totalDelay)}ms...`,
		);
		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connectScolia();
		}, totalDelay);
	}

	private handleScoliaMessage(data: string): void {
		try {
			const msg = JSON.parse(data);

			switch (msg.type) {
				case "HELLO_CLIENT":
					this.logger.debug("Received HELLO_CLIENT");
					break;

				case "THROW_DETECTED":
					this.eventOrchestrator.handleThrowDetected(msg);
					break;

				case "TAKEOUT_STARTED":
					this.eventOrchestrator.handleTakeoutStarted();
					break;

				case "TAKEOUT_FINISHED":
					this.eventOrchestrator.handleTakeoutFinished();
					break;

				case "SBC_STATUS":
				case "SBC_STATUS_CHANGED":
					this.logger.debug(`SBC Status: ${msg.status}`);
					break;

				case "ACKNOWLEDGED":
					this.logger.debug("Message acknowledged");
					break;

				case "REFUSED":
					this.logger.warn(`Message refused: ${msg.reason}`);
					break;

				default:
					this.logger.debug(`Unknown message type: ${msg.type}`);
			}
		} catch (err) {
			this.logger.error("Failed to parse Scolia message:", err);
		}
	}

	private async handleBustDetected(): Promise<void> {
		this.logger.info("Bust detected");
		if (this.config.sound.enabled) {
			await this.soundController.playSound("bust");
		}
	}

	private async handleLegWon(): Promise<void> {
		this.logger.info("Leg won");
		if (this.config.sound.enabled) {
			await this.soundController.playSound("leg_won");
		}
	}

	private async handleSetWon(): Promise<void> {
		this.logger.info("Set won");
		if (this.config.sound.enabled) {
			await this.soundController.playSound("set_won");
		}
	}

	async shutdown(): Promise<void> {
		this.logger.info("Shutting down...");
		this.running = false;

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		if (this.config.knx.enabled) {
			this.knxController.disconnect();
		}

		if (this.config.playwright.enabled) {
			await this.playwrightController.stop();
		}

		this.lightsharkController.close();
		this.soundController.close();
		this.logger.info("Shutdown complete");
		this.logger.close();
	}
}
