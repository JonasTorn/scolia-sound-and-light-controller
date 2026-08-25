import * as WebSocket from "ws";
import { Logger, LoggerConfig } from "./utils/Logger";
import { ConfigManager } from "./core/ConfigManager";
import { GameState } from "./core/GameState";
import { EventOrchestrator } from "./core/EventOrchestrator";
import { ScoreboardServer } from "./core/ScoreboardServer";
import { ScoliaHistoryScraper } from "./core/ScoliaHistoryScraper";
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
	private idleTimer: NodeJS.Timeout | null = null;
	private scoreboardServer: ScoreboardServer | null = null;
	private scoliaHistoryScraper: ScoliaHistoryScraper | null = null;
	private scoreboardShowing = false;
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
		this.soundController = new SoundController(this.config, this.logger);
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
			this.playwrightController,
		);

		// Attach Playwright event listeners for bust/leg-won/set-won
		this.playwrightController.on("bust", () => {
			this.handleBustDetected();
		});

		this.playwrightController.on("leg-won", (winner?: string) => {
			if (winner) {
				this.gameState.setCurrentPlayer(winner);
				this.soundController.setCurrentPlayer(winner);
			}
			this.handleLegWon();
		});

		this.playwrightController.on("set-won", (winner?: string) => {
			if (winner) {
				this.gameState.setCurrentPlayer(winner);
				this.soundController.setCurrentPlayer(winner);
			}
			this.handleSetWon();
		});

		this.playwrightController.on("eliminated", (name?: string) => {
			if (name) {
				this.gameState.setCurrentPlayer(name);
				this.soundController.setCurrentPlayer(name);
			}
			this.handlePlayerEliminated();
		});

		// Update active player when Playwright detects a new thrower
		this.playwrightController.on("player-change", (name: string) => {
			this.gameState.setCurrentPlayer(name);
			this.soundController.setCurrentPlayer(name);
			this.logger.info(`🎯 Active player: ${name}`);
		});

		this.playwrightController.on("game-mode", (mode: string) => {
			this.gameState.setGameMode(mode);
			// Bull-throw phase started — cancel scoreboard timer and return to game view
			if (this.config.scoreboard?.enabled) {
				this.cancelIdleTimer();
				if (this.scoreboardShowing) {
					this.scoreboardShowing = false;
					this.playwrightController.showGame().catch(() => {});
				}
			}
		});

		// Route Scolia messages intercepted from the web app's WebSocket
		this.playwrightController.on("scoliamessage", (data: string) => {
			this.handleScoliaMessage(data);
		});

		// Play a sound when a game starts based on player count
		this.playwrightController.on("game-started", (names: string[]) => {
			this.logger.info(`🎮 Game started with ${names.length} players`);
			this.cancelIdleTimer();
			if (this.config.scoreboard?.enabled) {
				this.scoreboardShowing = false;
				this.playwrightController.showGame().catch(() => {});
			}
			if (names.length >= 4) {
				this.soundController.playSound("important_round");
			}
		});

		// Mute Scolia's browser audio while the app plays its own sounds.
		// Set playwright.muteDuringOurSounds: false in config to let both play simultaneously.
		if (this.config.playwright.muteDuringOurSounds !== false) {
			this.soundController.on("playing", () => {
				this.playwrightController.muteAudio().catch(() => {});
			});
			this.soundController.on("stopped", () => {
				this.playwrightController.unmuteAudio().catch(() => {});
			});
		}
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

				// Start scoreboard server and open the scoreboard page in a background tab
				const sb = this.config.scoreboard;
				if (sb?.enabled) {
					const port = sb.port ?? 3456;
					const players = sb.players ?? Object.keys(this.config.players ?? {});
					const baseUrl = this.config.playwright.url ?? "https://game.scoliadarts.com";

					this.scoreboardServer = new ScoreboardServer(this.logger);
					this.scoreboardServer.start(port);

					this.scoliaHistoryScraper = new ScoliaHistoryScraper(
						this.logger,
						baseUrl,
						sb.vipMinPlayers ?? 3,
						sb.discoverStats ?? false,
					);

					await this.playwrightController.openScoreboardPage(`http://127.0.0.1:${port}`);
					// Opening a new tab steals browser focus — return focus to Scolia immediately.
					// The idle timer will switch to scoreboard if no game starts within startupDelay.
					await this.playwrightController.showGame();

					// Refresh stats immediately, then show scoreboard if no game starts soon
					await this.refreshScoreboardStats(players);
					const startupDelay = sb.startupDelayMs ?? 15000;
					this.startIdleTimer(startupDelay);
				}
			}

			// 4. Connect to Scolia WebSocket (direct API)
			// Skip when proxyWebSocket:true — throws come from the Playwright browser proxy instead.
			// Running both simultaneously causes every throw to fire twice.
			if (!this.config.scolia.simulationMode && !this.config.playwright.proxyWebSocket) {
				this.connectScolia();
			} else if (this.config.playwright.proxyWebSocket) {
				this.logger.info("proxyWebSocket enabled — throw events via Playwright browser proxy");
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
			const { serverUrl, serialNumber, accessToken } = this.config.scolia;
			const wsUrl = `${serverUrl}?serialNumber=${serialNumber}&accessToken=${accessToken}`;
			this.logger.info(`Connecting to Scolia: ${serverUrl}`);

			this.ws = new WebSocket.WebSocket(wsUrl);

			this.ws.on("open", () => {
				this.logger.success("✓ Scolia WebSocket connected");
				this.reconnectTimeout = null;
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
					this.logger.success("Scolia welcomed us");
					this.ws?.send(JSON.stringify({ type: "GET_SBC_STATUS" }));
					break;

				case "THROW_DETECTED": {
					// Any throw means game activity is happening — cancel scoreboard idle timer
					if (this.config.scoreboard?.enabled) {
						this.cancelIdleTimer();
						if (this.scoreboardShowing) {
							this.scoreboardShowing = false;
							this.playwrightController.showGame().catch(() => {});
						}
					}
					// Social API wraps data in payload; browser WS (proxyWebSocket:true) sends it flat
					const throwPayload = msg.payload ?? { sector: msg.sector, coordinates: msg.coordinates, bounceout: msg.bounceout };
					this.eventOrchestrator.handleThrowDetected(throwPayload);
					break;
				}

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
					// Log at info so we can identify elimination/game-state WS messages in production logs
					this.logger.info(`WS: ${msg.type} ${JSON.stringify(msg).slice(0, 200)}`);
			}
		} catch (err) {
			this.logger.error("Failed to parse Scolia message:", err);
		}
	}

	private async handleBustDetected(): Promise<void> {
		await this.eventOrchestrator.handleBustDetected();
	}

	private async handleLegWon(): Promise<void> {
		await this.eventOrchestrator.handleLegWon();
	}

	private async handleSetWon(): Promise<void> {
		await this.eventOrchestrator.handleSetWon();
		if (this.config.scoreboard?.enabled) {
			const delay = this.config.scoreboard.idleDelayMs ?? 30000;
			this.startIdleTimer(delay);
		}
	}

	private startIdleTimer(delayMs: number): void {
		this.cancelIdleTimer();
		this.idleTimer = setTimeout(async () => {
			this.idleTimer = null;
			const players = this.config.scoreboard?.players ?? Object.keys(this.config.players ?? {});
			await this.refreshScoreboardStats(players);
			this.scoreboardShowing = true;
			await this.playwrightController.showScoreboard();
		}, delayMs);
	}

	private cancelIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private async refreshScoreboardStats(players: string[]): Promise<void> {
		if (!this.scoreboardServer || !this.scoliaHistoryScraper) return;
		try {
			const stats = await this.scoliaHistoryScraper.scrape(
				() => this.playwrightController.createTemporaryPage(),
				players,
			);
			this.scoreboardServer.updateStats(stats);
		} catch (err) {
			this.logger.warn(`Scoreboard: Failed to refresh stats: ${err}`);
		}
	}

	private async handlePlayerEliminated(): Promise<void> {
		await this.eventOrchestrator.handlePlayerEliminated();
	}

	async shutdown(): Promise<void> {
		this.logger.info("Shutting down...");
		this.running = false;

		this.cancelIdleTimer();

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

		this.scoreboardServer?.stop();
		this.lightsharkController.close();
		this.soundController.close();
		this.logger.info("Shutdown complete");
		this.logger.close();
	}
}
