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
	eliminatedCount: number;
	playerNames: string[];
	playerTabMap: Array<{ id: string; nickname: string }>; // from playerTab-{hexId} DOM elements
	winnerName: string; // nickname extracted from winner element text
}

interface PlayerInfo {
	id: string;
	nickname: string;
}

export class PlaywrightController extends EventEmitter {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private scoreboardPage: Page | null = null;
	private scoreboardUrl: string | null = null;
	private running = false;
	private pollTimeout: NodeJS.Timeout | null = null;
	private lastHealthyAt = 0;
	private pollErrorLogged = false;
	private restarting = false;
	private restartAttempts = 0;
	private stableTimer: NodeJS.Timeout | null = null;
	private watchdogTimer: NodeJS.Timeout | null = null;

	private lastState: EdgeDetectionState = {
		bustCount: 0,
		legWon: false,
		setWon: false,
		eliminatedCount: 0,
		playerNames: [],
		playerTabMap: [],
		winnerName: "",
	};

	private players: Map<string, PlayerInfo> = new Map();
	private currentPlayerId: string | null = null;
	private lastLegWonAt = 0;
	private lastEliminatedAt = 0;
	private boardJoined = false;
	private lastBoardCheckAt = 0;
	private lastBackToSetupAt = 0;
	private processedThrowIndices = new Map<string, Set<number>>(); // playerId → Set of throwIndex
	private processedBullThrowPlayers = new Set<string>(); // dedup: which players' bull throws have been emitted this round
	private inTakeout = false; // true between TAKEOUT_STARTED and TAKEOUT_FINISHED — suppress elimination WS events during this window
	private domPlayerNames: string[] = []; // latest player names from DOM scoreboard (more reliable than WS PLAYER_JOINED)

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
				"--disable-features=Translate,TranslateUI",
				"--lang=en",
			];

			this.browser = await chromium.launch({
				headless: false,
				args: launchArgs,
			});

			this.browser.on("disconnected", () => {
				if (!this.running) return;
				this.logger.warn("Playwright: Browser disconnected — restarting");
				this.restart();
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

			// Reduce Scolia's browser audio to announcerVolume and silence it when muted.
			// __scoliaMuted is set by muteAudio()/unmuteAudio() while our own sounds play.
			// Intercepts both createGain (volume reduction) and AudioBufferSourceNode.start()
			// (more reliable muting — fires later in the audio pipeline than createGain).
			await this.context.addInitScript(({ volume }: { volume: number }) => {
				(window as any).__scoliaVolume = volume;

				const OriginalAudioContext = window.AudioContext || (window as any).webkitAudioContext;
				if (OriginalAudioContext) {
					const origCreateGain = OriginalAudioContext.prototype.createGain;
					OriginalAudioContext.prototype.createGain = function (this: AudioContext) {
						const node = origCreateGain.call(this);
						node.gain.value = (window as any).__scoliaMuted
							? 0
							: ((window as any).__scoliaVolume ?? 1.0);
						return node;
					};
				}

				const origStart = AudioBufferSourceNode.prototype.start;
				AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: any[]) {
					if ((window as any).__scoliaMuted) return;
					return (origStart as Function).apply(this, args);
				};
			}, { volume: this.config.announcerVolume ?? 1.0 });

			// Intercept WebSocket frames from the Scolia web app.
			// Set playwright.proxyWebSocket = false in config to disable when using the Scolia API directly.
			if (this.config.proxyWebSocket !== false) {
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
								this.inTakeout = true;
								this.processedThrowIndices.clear();
								this.emit("scoliamessage", JSON.stringify({ type: "TAKEOUT_STARTED" }));
							} else if (msg.type === "API::COMMON::TAKEOUT_FINISHED") {
								this.logger.debug("Playwright WS: TAKEOUT_FINISHED");
								this.inTakeout = false;
								this.emit("scoliamessage", JSON.stringify({ type: "TAKEOUT_FINISHED" }));
							} else if (msg.type === "API::GAME::GAME_STATE_CHANGED") {
								this.extractThrows(msg.payload);
							} else if (msg.type === "API::GAME::GAME_CURRENT_STATE") {
								// Full game state (not a diff) — sent at game start/reconnect.
								// Read currentPlayerUserId as a plain string to seed currentPlayerId.
								this.extractPlayers(msg.payload);
								const cpId = msg.payload?.state?.game?.currentPlayerUserId;
								if (typeof cpId === "string" && cpId !== this.currentPlayerId) {
									this.currentPlayerId = cpId;
									const name = this.getPlayerName(cpId);
									this.logger.info(`👤 Active player (from full state): ${name}`);
									this.emit("player-change", name);
								}
								// Emit game-started — prefer DOM names (always complete) over WS player map.
								const names = this.domPlayerNames.length
									? this.domPlayerNames
									: [...this.players.values()].map((p) => p.nickname);
								this.logger.info(`🎮 Game started (${names.length} players): ${names.join(", ")}`);
								this.emit("game-started", names);
							} else if (msg.type.endsWith("::GAME_STARTED")) {
								// Kept as fallback for any mode that sends this but not GAME_CURRENT_STATE.
								const names = this.domPlayerNames.length
									? this.domPlayerNames
									: [...this.players.values()].map((p) => p.nickname);
								if (!names.length) return; // already handled by GAME_CURRENT_STATE
								this.logger.info(`🎮 Game started via GAME_STARTED (${names.length} players): ${names.join(", ")}`);
								this.emit("game-started", names);
							} else if (msg.type === "API::BULL_THROW::GAME_CURRENT_STATE") {
								this.processedBullThrowPlayers.clear();
								this.players.clear(); // new game — drop stale players from previous game
								this.extractBullThrowPlayers(msg.payload);
							} else if (msg.type === "API::BULL_THROW::GAME_STATE_CHANGED") {
								this.extractBullThrows(msg.payload);
							} else if (msg.type === "API::BULL_THROW::GAME_ENDED") {
								this.processedBullThrowPlayers.clear();
								this.logger.info("Playwright WS recv: API::BULL_THROW::GAME_ENDED");
							} else if (msg.type === "API::COMMON::REFRESH_CLIENT_TOKEN") {
								this.logger.info("Playwright WS recv: API::COMMON::REFRESH_CLIENT_TOKEN");
								this.emit("token-refresh");
							} else {
								this.logger.info(`Playwright WS recv: ${msg.type}`);
							}
						} catch {
							// ignore non-JSON frames
						}
					});
				});
			} else {
				this.logger.info("Playwright: WS proxy disabled — using direct Scolia API for throw data");
			}

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

			// Dismiss cookie consent banner if present
			await this.dismissCookieBanner();

			// True fullscreen — hides browser title bar and Windows taskbar
			if (this.config.fullscreen) {
				await this.setFullscreen();
			}

			// Save cookies
			await this.saveCookies();

			// Re-open scoreboard page if it was open before (handles restarts)
			if (this.scoreboardUrl) {
				await this.openScoreboardPage(this.scoreboardUrl);
			}

			// Start polling for game events
			this.startPolling();
			this.logger.success("Playwright: Launched and monitoring");
		} catch (err) {
			this.logger.error(`Playwright launch failed: ${err}`);
			throw err;
		}
	}

	private extractPlayers(payload: any): void {
		// GAME_STATE_CHANGED may include full player list — grab names before they throw.
		// Handles two formats:
		//   - Array with p._id / p.playerId  (X01 / standard game states)
		//   - Dict keyed by player ID         (Elimination: state.game.players[id].nickname)
		const sources = [
			payload?.state?.players,
			payload?.players,
			payload?.state?.game?.players,
		];
		let added = false;
		for (const source of sources) {
			if (!source || typeof source !== "object") continue;
			const entries: [string, any][] = Array.isArray(source)
				? source.map((p: any) => [p?._id ?? p?.playerId ?? "", p])
				: Object.entries(source);
			for (const [keyId, p] of entries) {
				if (!p || typeof p !== "object") continue;
				const id: string = p._id ?? p.playerId ?? keyId;
				const { nickname } = p;
				if (id && nickname && !this.players.has(id)) {
					this.players.set(id, { id, nickname });
					this.logger.info(`👤 Player found in game state: ${nickname}`);
					added = true;
				}
			}
		}
		if (added) {
			const names = [...this.players.values()].map((p) => p.nickname);
			this.logger.info(`👥 Current player list (${names.length}): ${names.join(", ")}`);
			this.emit("players-updated", names);
		}
	}

	private extractThrows(payload: any): void {
		this.extractPlayers(payload);

		const game = payload?.state?.game;
		if (!game) return;

		const triplets = game.lastTriplets;
		if (triplets && typeof triplets === "object") {
			this.extractTripletThrows(triplets);
		} else if (game.players || game.currentPlayerUserId !== undefined) {
			this.extractElimModeThrows(game);
		}
	}

	// 501 / standard mode: throws arrive in lastTriplets[playerId][dartIndex]
	private extractTripletThrows(triplets: any): void {
		for (const playerId of Object.keys(triplets)) {
			const playerDarts = triplets[playerId];
			if (!playerDarts || typeof playerDarts !== "object") continue;

			const hasNewThrows = Object.keys(playerDarts).some((k) => /^\d+$/.test(k));
			if (!hasNewThrows) continue;

			if (playerId !== this.currentPlayerId) {
				this.currentPlayerId = playerId;
				const name = this.getPlayerName(playerId);
				this.logger.info(`👤 Current player: ${name}`);
				this.emit("player-change", name);
			}

			for (const key of Object.keys(playerDarts)) {
				if (!/^\d+$/.test(key)) continue;

				const dartArray = playerDarts[key];
				if (!Array.isArray(dartArray) || dartArray.length === 0) continue;

				const dart = dartArray[0];
				if (!dart || typeof dart !== "object" || !dart.sector) continue;

				const name = this.getPlayerName(playerId);
				this.logger.info(`Playwright: Throw — ${name}: ${dart.sector} = ${dart.score}p (remaining: ${dart.remainingScore})`);
				this.emit("scoliamessage", JSON.stringify({
					type: "THROW_DETECTED",
					sector: dart.sector,
					coordinates: dart.coordinates || [0, 0],
					bounceout: dart.bounceout || false,
				}));

				if (dart.remainingScore === 0) {
					this.lastLegWonAt = Date.now();
					this.logger.info(`🏆 Leg won: ${name} finished on ${dart.sector}!`);
					this.emit("leg-won");
				}
			}
		}
	}

	// Bull throw phase: each player throws one dart to determine game order.
	// Scolia sends a full snapshot each time (all players), so we dedup by playerId.
	private extractBullThrows(payload: any): void {
		this.extractBullThrowPlayers(payload); // payload also carries nextGame.players
		const gameState = payload?.gameState;
		if (!gameState || gameState.currentGamePhase !== "WaitingForTakeout") return;

		const triplets = gameState.lastTriplets;
		if (!triplets || typeof triplets !== "object") return;

		for (const playerId of Object.keys(triplets)) {
			const throws = triplets[playerId];
			if (!Array.isArray(throws) || throws.length === 0) continue;
			if (this.processedBullThrowPlayers.has(playerId)) continue;

			this.processedBullThrowPlayers.add(playerId);
			const dart = throws[0];
			if (!dart?.sector) continue;

			const name = this.getPlayerName(playerId);
			this.logger.info(`Playwright: Bull throw — ${name}: ${dart.sector}`);
			this.emit("scoliamessage", JSON.stringify({
				type: "THROW_DETECTED",
				sector: dart.sector,
				coordinates: dart.coordinates || [0, 0],
				bounceout: dart.bounceout || false,
			}));
		}
	}

	private extractBullThrowPlayers(payload: any): void {
		const nextGame = payload?.gameState?.configuration?.nextGame;
		if (!nextGame) return;

		const gameType: string | undefined = nextGame.gameType;
		if (gameType) {
			this.logger.info(`🎮 Game mode: ${gameType}`);
			this.emit("game-mode", gameType);
		}

		const players = nextGame.players;
		if (!Array.isArray(players)) return;
		let added = false;
		for (const p of players) {
			if (p?.playerId && p?.nickname && !this.players.has(p.playerId)) {
				this.players.set(p.playerId, { id: p.playerId, nickname: p.nickname });
				added = true;
			}
		}
		if (added) {
			const names = [...this.players.values()].map((p) => p.nickname);
			this.logger.info(`👥 Bull throw players (${names.length}): ${names.join(", ")}`);
		}
	}

	// Elimination (and other non-501) modes: throws in players[playerId].currentRound[dartIndex]
	private extractElimModeThrows(game: any): void {
		// Handle active player switch — must run before processing throws
		const cpuDelta = game.currentPlayerUserId;
		if (Array.isArray(cpuDelta)) {
			const newId = cpuDelta.length >= 2 ? cpuDelta[1] : cpuDelta[0];
			if (typeof newId === "string" && newId !== this.currentPlayerId) {
				this.currentPlayerId = newId;
				const name = this.getPlayerName(newId);
				this.logger.info(`👤 Active player: ${name}`);
				this.emit("player-change", name);
			}
		}

		const playersDiff = game.players;
		if (!playersDiff || typeof playersDiff !== "object") return;

		for (const playerId of Object.keys(playersDiff)) {
			const playerDiff = playersDiff[playerId];
			if (!playerDiff || typeof playerDiff !== "object") continue;

			// Log any status or score changes so we can see what Scolia sends
			if (playerDiff.status !== undefined) {
				this.logger.info(`WS player status delta [${this.getPlayerName(playerId)}]: ${JSON.stringify(playerDiff.status)}`);
			}
			if (playerDiff.score !== undefined) {
				this.logger.info(`WS player score delta [${this.getPlayerName(playerId)}]: ${JSON.stringify(playerDiff.score)}`);
			}

			// Detect elimination via status field change: ["active", "eliminated"] or similar.
			// Suppressed during takeout — Scolia sometimes re-sends eliminated status in the
			// GAME_STATE_CHANGED that arrives around TAKEOUT_FINISHED, causing a false re-fire.
			const statusDelta = playerDiff.status;
			if (!this.inTakeout && Array.isArray(statusDelta)) {
				const newStatus = statusDelta.length >= 2 ? statusDelta[1] : statusDelta[0];
				if (typeof newStatus === "string" && newStatus.toLowerCase().includes("eliminat")) {
					const name = this.getPlayerName(playerId);
					this.logger.info(`💀 Player eliminated: ${name}`);
					this.emit("eliminated", name);
				}
			}

			// Extract new darts from currentRound diff
			const roundDiff = playerDiff.currentRound;
			if (!roundDiff || typeof roundDiff !== "object") continue;

			// Only emit throws for the currently active player
			if (playerId !== this.currentPlayerId) continue;

			for (const key of Object.keys(roundDiff)) {
				if (!/^\d+$/.test(key)) continue; // skip _t, _0, _1 (jsondiffpatch metadata)

				const delta = roundDiff[key];
				if (!Array.isArray(delta) || delta.length === 0) continue;
				if (delta.length === 3) continue; // [old, 0, 0] = deletion, skip

				// Unwrap jsondiffpatch delta: [newVal] = added,  [oldVal, newVal] = modified
				const dart = delta.length === 1 ? delta[0] : delta[1];
				if (!dart || typeof dart !== "object" || !dart.sector) continue;

				// Skip darts we already emitted in this round (Elimination diffs re-include previous darts)
				const throwIdx = typeof dart.throwIndex === "number" ? dart.throwIndex : -1;
				if (throwIdx >= 0) {
					const seen = this.processedThrowIndices.get(playerId) ?? new Set<number>();
					if (seen.has(throwIdx)) continue;
					seen.add(throwIdx);
					this.processedThrowIndices.set(playerId, seen);
				}

				const name = this.getPlayerName(playerId);
				this.logger.info(`Playwright: Throw — ${name}: ${dart.sector} = ${dart.score}p`);
				this.emit("scoliamessage", JSON.stringify({
					type: "THROW_DETECTED",
					sector: dart.sector,
					coordinates: dart.coordinates || [0, 0],
					bounceout: dart.bounceout || false,
				}));
			}
		}
	}

	private startPolling(): void {
		this.running = true;
		this.resetWatchdog();
		this.poll();
	}

	private resetWatchdog(): void {
		if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
		this.watchdogTimer = setTimeout(() => {
			this.logger.warn("Playwright: Watchdog fired — page unresponsive for 15s, restarting");
			this.restart();
		}, 15000);
	}

	private async restart(): Promise<void> {
		if (this.restarting) return;
		this.restarting = true;

		if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); this.watchdogTimer = null; }
		if (this.stableTimer) { clearTimeout(this.stableTimer); this.stableTimer = null; }

		const delay = Math.min(2000 * Math.pow(2, this.restartAttempts), 60000);
		this.logger.warn(`Playwright: Restarting in ${delay / 1000}s (attempt ${this.restartAttempts + 1})`);
		this.restartAttempts++;

		await this.stop();
		await new Promise(res => setTimeout(res, delay));

		this.restarting = false;
		try {
			await this.launch();
			this.stableTimer = setTimeout(() => { this.restartAttempts = 0; }, 60000);
		} catch (err) {
			this.logger.error(`Playwright: Restart failed: ${err}`);
			this.restart();
		}
	}

	private async poll(): Promise<void> {
		if (!this.running || !this.page) return;

		try {
			const boardName = this.config.boardName;
			if (boardName && !this.boardJoined && Date.now() - this.lastBoardCheckAt >= 1000) {
				this.lastBoardCheckAt = Date.now();
				const found = await this.page.evaluate((name) => {
					const el = Array.from(document.querySelectorAll('[class*="boardName"]'))
						.find(e => e.textContent?.includes(name)) as HTMLElement | undefined;
					if (el) { el.click(); return true; }
					return false;
				}, boardName);
				if (found) {
					this.boardJoined = true;
					this.logger.info(`Playwright: Auto-joined board "${boardName}"`);
				}
			}
		} catch (err) {
			this.logger.debug(`Playwright: Board join check error: ${err}`);
		}

		// Auto-click "Back to Setup" when results screen appears after a set/match ends.
		// Check every 2s to avoid spam — the button only exists on the results screen.
		if (Date.now() - this.lastBackToSetupAt >= 2000) {
			this.lastBackToSetupAt = Date.now();
			try {
				const clicked = await this.page.evaluate(() => {
					const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
					const btn = els.find(el => {
						const text = el.textContent?.trim().toLowerCase() ?? "";
						return text.includes("back to setup") || text.includes("back to game") || text.includes("new game");
					}) as HTMLElement | undefined;
					if (btn) { btn.click(); return true; }
					return false;
				});
				if (clicked) this.logger.info("Playwright: Auto-clicked Back to Setup");
			} catch (err) {
				this.logger.debug(`Playwright: Back-to-setup check error: ${err}`);
			}
		}

		try {
			const state = await this.page.evaluate(() => {
				const bustElements = document.querySelectorAll(
					'[class*="statusInfoBusted"], [class*="isBusted"], [class*="Busted"], [class*="busted"]',
				);

				// Scoped to winner/result elements to avoid false positives
				const winnerEl = document.querySelector('[class*="winnerTile"], [class*="winner"], [class*="gameOver"], [class*="game-over"]');
				const winnerText = winnerEl?.textContent?.toLowerCase() ?? "";
				const winnerTextRaw = winnerEl?.textContent?.trim() ?? "";

				const legWon = winnerText.includes("won the leg");
				// "won the set" = 501 sets; "won the game" = elimination final win
				const setWon = winnerText.includes("won the set") || winnerText.includes("won the game");

				// Count of eliminated player rows (increases as players are knocked out)
				const eliminatedCount = document.querySelectorAll(
					'[class*="eliminated"], [class*="Eliminated"], [class*="isEliminated"]',
				).length + (winnerText.includes("eliminated") ? 1 : 0);

				// Player names + IDs from scoreboard tabs (visible during throw-for-bull and game)
				// Tab elements have id="playerTab-{hexId}" so we get both pieces in one pass.
				const playerTabMap = Array.from(
					document.querySelectorAll('[id^="playerTab-"]'),
				).map((tab) => ({
					id: tab.id.replace("playerTab-", ""),
					nickname: tab.querySelector('[class*="nickname"]')?.textContent?.trim() ?? "",
				})).filter((p) => p.id && p.nickname);
				const playerNames = playerTabMap.map((p) => p.nickname);

				// Extract winner name: match known player nicknames against winner element text
				const winnerName = playerTabMap.find(
					(p) => p.nickname && winnerTextRaw.toLowerCase().includes(p.nickname.toLowerCase()),
				)?.nickname ?? "";

				return {
					bustCount: bustElements.length,
					legWon,
					setWon,
					eliminatedCount,
					playerNames,
					playerTabMap,
					winnerName,
				};
			});

			this.lastHealthyAt = Date.now();
			this.pollErrorLogged = false;
			this.resetWatchdog();

			// Edge detection
			const stateChanged =
				state.bustCount !== this.lastState.bustCount ||
				state.legWon !== this.lastState.legWon ||
				state.setWon !== this.lastState.setWon ||
				state.eliminatedCount !== this.lastState.eliminatedCount;

			if (state.bustCount > this.lastState.bustCount) {
				this.emit("bust");
				this.logger.info("Bust detected via DOM");
			}

			if (state.legWon && !this.lastState.legWon) {
				// Only fire if WebSocket didn't already catch it (within 2s)
				if (Date.now() - this.lastLegWonAt > 2000) {
					this.emit("leg-won", state.winnerName || undefined);
					this.logger.info(`Leg won detected via DOM${state.winnerName ? ` (${state.winnerName})` : ""}`);
				}
			}

			if (state.setWon && !this.lastState.setWon) {
				this.emit("set-won", state.winnerName || undefined);
				this.logger.info(`Set won detected via DOM${state.winnerName ? ` (${state.winnerName})` : ""}`);
			}

			// Eliminated: fire when count rises. Never let it decrease in lastState so
			// DOM flicker (indicator briefly disappears then reappears) can't re-fire.
			if (state.eliminatedCount > this.lastState.eliminatedCount) {
				this.emit("eliminated");
				this.logger.info("Player eliminated detected via DOM");
			}

			// Populate players Map from DOM tab IDs — resolves hex IDs to nicknames even when
			// WS PLAYER_JOINED messages were missed (e.g. app started mid-game).
			for (const { id, nickname } of state.playerTabMap) {
				if (!this.players.has(id)) {
					this.players.set(id, { id, nickname });
					this.logger.info(`👤 Player from DOM: ${nickname} (${id})`);
					// If the active player was already announced with a raw ID, correct it now.
					if (id === this.currentPlayerId) {
						this.logger.info(`🔄 Correcting active player name: ${nickname}`);
						this.emit("player-change", nickname);
					}
				}
			}

			// Players: emit when list changes (from throw-for-bull scoreboard)
			const namesJoined = state.playerNames.join(",");
			const lastNamesJoined = this.lastState.playerNames.join(",");
			if (namesJoined !== lastNamesJoined && state.playerNames.length > 0) {
				this.domPlayerNames = state.playerNames;
				this.logger.info(`👥 Players from DOM (${state.playerNames.length}): ${state.playerNames.join(", ")}`);
				this.emit("players-updated", state.playerNames);
			}

			this.lastState = {
				...state,
				eliminatedCount: Math.max(state.eliminatedCount, this.lastState.eliminatedCount),
			};

			// Save timestamped snapshot on state change — debug only (never overwrites)
			if (this.config.debug && stateChanged) {
				this.saveSnapshot().catch(() => {});
			}
		} catch (err) {
			if (!this.pollErrorLogged) {
				this.logger.warn(`Playwright poll error: ${err}`);
				this.pollErrorLogged = true;
			}
		}

		const pollInterval = this.config.pollIntervalMs || 200;
		this.pollTimeout = setTimeout(() => this.poll(), pollInterval);
	}

	private async setFullscreen(): Promise<void> {
		if (!this.page) return;
		try {
			const session = await this.page.context().newCDPSession(this.page);
			const { windowId } = await session.send("Browser.getWindowForTarget");
			await session.send("Browser.setWindowBounds", {
				windowId,
				bounds: { windowState: "fullscreen" },
			});
			await session.detach();
			this.logger.info("Playwright: Browser set to fullscreen");
		} catch (err) {
			this.logger.warn(`Playwright: Fullscreen failed: ${err}`);
		}
	}

	private async saveSnapshot(): Promise<void> {
		if (!this.page) return;
		try {
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const dir = path.join(process.cwd(), "debug-snapshots");
			if (!fs.existsSync(dir)) fs.mkdirSync(dir);
			const html = await this.page.content();
			fs.writeFileSync(path.join(dir, `dom-snapshot-${ts}.html`), html);
			await this.page.screenshot({ path: path.join(dir, `dom-snapshot-${ts}.png`), fullPage: false });
			this.logger.debug(`Playwright: Snapshot saved: debug-snapshots/dom-snapshot-${ts}`);
		} catch (err) {
			this.logger.debug(`Playwright: Snapshot failed: ${err}`);
		}
	}

	private async dismissCookieBanner(): Promise<void> {
		if (!this.page) return;
		try {
			// Try known class first, then fall back to any visible "Accept"/"Accept all" button
			const selector = '[class*="acceptButton"], button:has-text("Accept all"), button:has-text("Accept")';
			const btn = await this.page.$(selector);
			if (btn) {
				await btn.click({ timeout: 3000 }).catch(() => {});
				this.logger.info("Playwright: Cookie banner dismissed");
			}
		} catch {
			this.logger.debug("Playwright: No cookie banner found");
		}
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

	async openScoreboardPage(url: string): Promise<void> {
		if (!this.context) return;
		this.scoreboardUrl = url;
		try {
			this.scoreboardPage = await this.context.newPage();
			await this.scoreboardPage.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
			this.logger.info(`Playwright: Scoreboard page ready at ${url}`);
		} catch (err) {
			this.logger.warn(`Playwright: Failed to open scoreboard page: ${err}`);
			this.scoreboardPage = null;
		}
	}

	async showScoreboard(): Promise<void> {
		if (!this.scoreboardPage) return;
		try {
			await this.scoreboardPage.reload({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
			await this.scoreboardPage.bringToFront();
			this.logger.info("Playwright: Scoreboard shown");
		} catch (err) {
			this.logger.warn(`Playwright: Could not show scoreboard: ${err}`);
		}
	}

	async showGame(): Promise<void> {
		if (!this.page) return;
		try {
			await this.page.bringToFront();
			this.logger.info("Playwright: Game page shown");
		} catch (err) {
			this.logger.warn(`Playwright: Could not show game page: ${err}`);
		}
	}

	// Returns a new temporary page in the same browser context (shared cookies).
	// Caller is responsible for closing the page when done.
	async createTemporaryPage(): Promise<Page | null> {
		if (!this.context) return null;
		try {
			return await this.context.newPage();
		} catch {
			return null;
		}
	}

	async showOverlay(file: string, durationMs: number): Promise<void> {
		if (!this.page) return;
		if (!file) return; // empty file = skip overlay silently

		const filePath = path.resolve(process.cwd(), file);
		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
			this.logger.warn(`Playwright: Overlay file not found: ${filePath}`);
			return;
		}

		const overlayCfg = this.config.overlay ?? {};
		const background = overlayCfg.background ?? "rgba(0,0,0,0.65)";
		const objectFit  = overlayCfg.objectFit  ?? "contain";
		const width      = overlayCfg.width       ?? "100%";
		const height     = overlayCfg.height      ?? "100%";
		const duration   = durationMs > 0 ? durationMs : (overlayCfg.defaultDurationMs ?? 5000);

		const ext = path.extname(filePath).slice(1).toLowerCase();
		const mime = ext === "gif" ? "image/gif" : ext === "png" ? "image/png" : "image/jpeg";
		const dataUri = `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;

		try {
			await this.page.evaluate(
				({ uri, duration, background, objectFit, width, height }: {
					uri: string; duration: number; background: string;
					objectFit: string; width: string; height: string;
				}) => {
					const existing = document.getElementById("dart-overlay");
					if (existing) existing.remove();

					const style = document.createElement("style");
					style.textContent = `
						@keyframes dartOverlayIn { from { opacity: 0; transform: scale(1.05); } to { opacity: 1; transform: scale(1); } }
						@keyframes dartOverlayOut { from { opacity: 1; } to { opacity: 0; } }
					`;
					document.head.appendChild(style);

					const overlay = document.createElement("div");
					overlay.id = "dart-overlay";
					overlay.style.cssText = [
						"position:fixed", "inset:0", "z-index:2147483647",
						`background:${background}`,
						"display:flex", "align-items:center", "justify-content:center",
						"animation:dartOverlayIn 0.3s ease-out forwards",
						"cursor:pointer",
					].join(";");

					const img = document.createElement("img");
					img.src = uri;
					img.style.cssText = `width:${width};height:${height};object-fit:${objectFit};background:transparent`;
					overlay.appendChild(img);
					document.body.appendChild(overlay);

					const dismiss = () => {
						overlay.style.animation = "dartOverlayOut 0.3s ease-in forwards";
						setTimeout(() => overlay.remove(), 300);
					};
					overlay.addEventListener("click", dismiss);
					setTimeout(dismiss, duration);
				},
				{ uri: dataUri, duration, background, objectFit, width, height },
			);
			this.logger.info(`Playwright: Showing overlay "${file}" (${duration}ms)`);
		} catch (err) {
			this.logger.warn(`Playwright: Overlay injection failed: ${err}`);
		}
	}

	async muteAudio(): Promise<void> {
		if (!this.page) return;
		try {
			await this.page.evaluate(() => { (window as any).__scoliaMuted = true; });
		} catch {
			// Page may not be available — ignore
		}
	}

	async unmuteAudio(): Promise<void> {
		if (!this.page) return;
		try {
			await this.page.evaluate(() => { (window as any).__scoliaMuted = false; });
		} catch {
			// Page may not be available — ignore
		}
	}

	async stop(): Promise<void> {
		this.running = false;

		if (this.pollTimeout) {
			clearTimeout(this.pollTimeout);
			this.pollTimeout = null;
		}

		if (this.watchdogTimer) {
			clearTimeout(this.watchdogTimer);
			this.watchdogTimer = null;
		}

		if (this.stableTimer) {
			clearTimeout(this.stableTimer);
			this.stableTimer = null;
		}

		if (this.scoreboardPage) {
			await this.scoreboardPage.close().catch(() => {});
			this.scoreboardPage = null;
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
