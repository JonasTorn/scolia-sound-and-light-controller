import { EventEmitter } from "events";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/Logger";
import { PlaywrightConfig } from "../types/index";

interface EdgeDetectionState {
	bustCount: number;
	legWon: boolean;
	setWon: boolean;
}

interface PlayerInfo {
	id: string;
	nickname: string;
}

export class PlaywrightController extends EventEmitter {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private running = false;
	private pollTimeout: NodeJS.Timeout | null = null;
	private lastHealthyAt = 0;
	private pollErrorLogged = false;

	private lastState: EdgeDetectionState = {
		bustCount: 0,
		legWon: false,
		setWon: false,
	};

	private players: Map<string, PlayerInfo> = new Map();

	getPlayerName(id: string): string {
		return this.players.get(id)?.nickname ?? id;
	}

	constructor(
		private config: PlaywrightConfig,
		private logger: Logger,
	) {
		super();
	}

	async launch(): Promise<void> {
		try {
			const launchArgs = [
				"--start-maximized",
				"--disable-features=Translate,TranslateUI",
				"--lang=en",
			];

			this.browser = await chromium.launch({
				headless: false,
				args: launchArgs,
			});

			this.context = await this.browser.newContext({
				viewport: null,
				locale: "en-US",
			});

			// Load saved cookies if available
			const cookieFile =
				this.config.cookieFile ||
				path.join(process.cwd(), "scolia-cookies.json");
			if (fs.existsSync(cookieFile)) {
				try {
					const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
					await this.context.addCookies(cookies);
					this.logger.info("Playwright: Loaded saved cookies");
				} catch (err) {
					this.logger.warn(`Playwright: Could not load cookies: ${err}`);
				}
			}

			this.page = await this.context.newPage();

			// Intercept WebSocket frames from the Scolia web app
			this.page.on("websocket", (ws) => {
				this.logger.debug(`Playwright: WebSocket opened: ${ws.url()}`);
				ws.on("framereceived", (frame) => {
					const payload =
						typeof frame.payload === "string"
							? frame.payload
							: frame.payload.toString("utf-8");
					try {
						const msg = JSON.parse(payload);
						if (!msg.type) return;

						if (msg.type === "API::COMMON::PLAYER_JOINED") {
							const p = msg.payload?.player;
							if (p?._id && p?.nickname) {
								this.players.set(p._id, { id: p._id, nickname: p.nickname });
								this.logger.info(`👤 Player joined: ${p.nickname} (${p._id})`);
							}
						} else if (msg.type === "API::COMMON::TAKEOUT_STARTED") {
							this.logger.debug("Playwright WS: TAKEOUT_STARTED");
							this.emit("scoliamessage", JSON.stringify({ type: "TAKEOUT_STARTED" }));
						} else if (msg.type === "API::COMMON::TAKEOUT_FINISHED") {
							this.logger.debug("Playwright WS: TAKEOUT_FINISHED");
							this.emit("scoliamessage", JSON.stringify({ type: "TAKEOUT_FINISHED" }));
						} else if (msg.type === "API::GAME::GAME_STATE_CHANGED") {
							this.extractThrows(msg.payload);
						}
					} catch {
						// ignore non-JSON frames
					}
				});
			});

			const url = this.config.url || "https://game.scoliadarts.com";
			this.logger.info(`Playwright: Navigating to ${url}/game`);
			await this.page.goto(`${url}/game`, {
				waitUntil: "domcontentloaded",
				timeout: 30000,
			});

			// Wait for SPA to render
			await this.page
				.waitForSelector(
					'#email, #password, [class*="dartboard"], [class*="scoreboard"]',
					{ timeout: 15000 },
				)
				.catch(() => {
					this.logger.debug("Playwright: Timeout waiting for SPA render");
				});

			// Check if login needed
			const needsLogin = await this.page.evaluate(() => {
				return !!document.querySelector("#email");
			});

			if (needsLogin) {
				const { email, password } = this.config.credentials || {};
				if (email && password) {
					this.logger.info("Playwright: Logging in automatically...");
					try {
						await this.page.fill("#email", email);
						await this.page.fill("#password", password);
						await this.page.click('button[type="submit"]');
						await this.page
							.waitForNavigation({ timeout: 15000 })
							.catch(() => {});
					} catch (err) {
						this.logger.warn(`Playwright: Auto-login failed: ${err}`);
					}
				} else {
					this.logger.warn(
						"Playwright: Login required — log in manually in browser",
					);
				}
			}

			// Save cookies
			await this.saveCookies();

			// Start polling for game events
			this.startPolling();
			this.logger.success("Playwright: Launched and monitoring");
		} catch (err) {
			this.logger.error(`Playwright launch failed: ${err}`);
			throw err;
		}
	}

	private extractThrows(payload: any): void {
		const triplets = payload?.state?.game?.lastTriplets;
		if (!triplets || typeof triplets !== "object") return;

		for (const playerId of Object.keys(triplets)) {
			const playerDarts = triplets[playerId];
			if (!playerDarts || typeof playerDarts !== "object") continue;

			for (const key of Object.keys(playerDarts)) {
				// Only process numeric keys (0, 1, 2) — new dart additions
				// Skip _t, _0, _1, _2 (jsondiffpatch metadata/deletions)
				if (!/^\d+$/.test(key)) continue;

				const dartArray = playerDarts[key];
				if (!Array.isArray(dartArray) || dartArray.length === 0) continue;

				const dart = dartArray[0];
				if (!dart || typeof dart !== "object" || !dart.sector) continue;

				const throwMsg = JSON.stringify({
					type: "THROW_DETECTED",
					sector: dart.sector,
					coordinates: dart.coordinates || [0, 0],
					bounceout: dart.bounceout || false,
				});

				const name = this.getPlayerName(playerId);
				this.logger.info(`Playwright: Throw — ${name}: ${dart.sector} = ${dart.score}p (remaining: ${dart.remainingScore})`);
				this.emit("scoliamessage", throwMsg);
			}
		}
	}

	private startPolling(): void {
		this.running = true;
		this.poll();
	}

	private async poll(): Promise<void> {
		if (!this.running || !this.page) return;

		try {
			const state = await this.page.evaluate(() => {
				const bustElements = document.querySelectorAll(
					'[class*="statusInfoBusted"], [class*="isBusted"]',
				);
				const legWon = !!document
					.querySelector('[class*="winnerTile"]')
					?.textContent?.includes("Won the Leg");
				const setWon = !!document
					.querySelector('[class*="winnerTile"]')
					?.textContent?.includes("Won the Set");

				return {
					bustCount: bustElements.length,
					legWon,
					setWon,
				};
			});

			this.lastHealthyAt = Date.now();
			this.pollErrorLogged = false;

			// Edge detection
			if (state.bustCount > this.lastState.bustCount) {
				this.emit("bust");
				this.logger.info("Bust detected via DOM");
			}

			if (state.legWon && !this.lastState.legWon) {
				this.emit("leg-won");
				this.logger.info("Leg won detected via DOM");
			}

			if (state.setWon && !this.lastState.setWon) {
				this.emit("set-won");
				this.logger.info("Set won detected via DOM");
			}

			this.lastState = state;
		} catch (err) {
			if (!this.pollErrorLogged) {
				this.logger.warn(`Playwright poll error: ${err}`);
				this.pollErrorLogged = true;
			}
		}

		const pollInterval = this.config.pollIntervalMs || 200;
		this.pollTimeout = setTimeout(() => this.poll(), pollInterval);
	}

	private async saveCookies(): Promise<void> {
		try {
			if (!this.context) return;
			const cookies = await this.context.cookies();
			const cookieFile =
				this.config.cookieFile ||
				path.join(process.cwd(), "scolia-cookies.json");
			fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
			this.logger.debug("Playwright: Cookies saved");
		} catch (err) {
			this.logger.warn(`Playwright: Could not save cookies: ${err}`);
		}
	}

	async stop(): Promise<void> {
		this.running = false;

		if (this.pollTimeout) {
			clearTimeout(this.pollTimeout);
			this.pollTimeout = null;
		}

		if (this.page) {
			await this.page.close().catch(() => {});
			this.page = null;
		}

		if (this.context) {
			await this.context.close().catch(() => {});
			this.context = null;
		}

		if (this.browser) {
			await this.browser.close().catch(() => {});
			this.browser = null;
		}

		this.logger.info("Playwright: Stopped");
	}
}
