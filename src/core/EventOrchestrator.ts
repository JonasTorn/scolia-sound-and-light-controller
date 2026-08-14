import { ScoliaThrowPayload, GameThrow, FullConfig, Effect, ILightSharkController, ISoundController, IKNXController, IPlaywrightController, ExecutorRef, LightSharkExecutor } from "../types/index";
import { Logger } from "../utils/Logger";
import { SectorParser } from "../utils/SectorParser";
import { GameState } from "./GameState";
import { SpecialEventDetector } from "./SpecialEventDetector";
import { EffectExecutor } from "./EffectExecutor";
import { resolveExecutor } from "../utils/ExecutorResolver";
import { gameEventsConfig } from "../config/events.config";

export interface IEventOrchestrator {
	handleThrowDetected(payload: ScoliaThrowPayload): Promise<void>;
	handleTakeoutFinished(): Promise<void>;
	handleTakeoutStarted(): Promise<void>;
	handleBustDetected(): Promise<void>;
	handleLegWon(): Promise<void>;
	handleSetWon(): Promise<void>;
	handlePlayerEliminated(): Promise<void>;
}

export class EventOrchestrator implements IEventOrchestrator {
	private specialEventDetector: SpecialEventDetector;
	private effectExecutor: EffectExecutor;

	constructor(
		private gameState: GameState,
		private config: FullConfig,
		private logger: Logger,
		lightsharkController: ILightSharkController,
		soundController: ISoundController,
		knxController: IKNXController,
		playwrightController?: IPlaywrightController,
	) {
		this.specialEventDetector = new SpecialEventDetector(undefined, config.executors ?? {});
		this.effectExecutor = new EffectExecutor(
			gameState,
			lightsharkController,
			soundController,
			knxController,
			config,
			logger,
			playwrightController,
		);
	}

	async handleThrowDetected(payload: ScoliaThrowPayload): Promise<void> {
		try {
			const throwData = this.parseAndAdjust(payload);
			this.gameState.addThrow(throwData);
			const throwIndex = this.gameState.getThrowHistory().length - 1;

			const specialEvent = this.specialEventDetector.detect(
				this.gameState.getThrowHistory().slice(0, -1),
				throwData,
				this.gameState.getCurrentPlayer(),
			);

			if (specialEvent && !this.gameState.isEventPlayed(throwIndex, specialEvent.name)) {
				this.logger.success(`🎉 Special Event: ${specialEvent.name}`);
				this.gameState.markEventPlayed(throwIndex, specialEvent.name);
			}

			// Special event sound replaces base throw sound; special lights/overlays stack on top.
			const specialHasSound = specialEvent?.effects.some((e) => e.type === "sound") ?? false;
			const effects: Effect[] = [];
			if (!specialHasSound) {
				effects.push({ type: "sound", isThrowSound: true, event: this.resolveThrowSoundName(throwData) });
			}
			effects.push(...this.resolveThrowLightEffects(throwData));
			if (specialEvent) effects.push(...specialEvent.effects);

			await this.effectExecutor.execute(effects);

			this.logger.info(
				`Throw: ${throwData.segment}${this.multiplierSuffix(throwData.multiplier)} = ${throwData.points}p`,
			);
		} catch (err) {
			this.logger.error("Error handling throw:", err);
		}
	}

	async handleTakeoutFinished(): Promise<void> {
		try {
			this.logger.info("Takeout finished");
			if (this.config.sound.takeoutSoundEnabled !== false) {
				await this.effectExecutor.execute([{ type: "sound", event: "takeout" }]);
			}
		} catch (err) {
			this.logger.error("Error handling takeout:", err);
		}
	}

	async handleTakeoutStarted(): Promise<void> {
		this.logger.info("Takeout started - resetting state");
		await this.effectExecutor.cleanup(); // release lights before reset clears lastExecutor
		this.gameState.reset();
	}

	async handleBustDetected(): Promise<void>     { await this.fireGameEvent("bust", "Bust detected"); }
	async handleLegWon(): Promise<void>           { await this.fireGameEvent("leg_won", "Leg won"); }
	async handleSetWon(): Promise<void>           { await this.fireGameEvent("set_won", "Set won"); }
	async handlePlayerEliminated(): Promise<void> { await this.fireGameEvent("eliminated", "Player eliminated"); }

	private async fireGameEvent(name: string, logMsg: string): Promise<void> {
		try {
			const player = this.gameState.getCurrentPlayer();
			this.logger.info(`${logMsg} (player: ${player ?? "unknown"})`);
			const cfg = gameEventsConfig[name];
			// Fall back to another event's config if this one has no sound/overlay set
			const baseCfg = (!cfg?.sound && !cfg?.overlay && cfg?.fallback)
				? (gameEventsConfig[cfg.fallback] ?? cfg)
				: cfg;
			const overwrite = player ? (cfg?.playerOverwrites?.[player] ?? baseCfg?.playerOverwrites?.[player]) : undefined;

			const sound = overwrite?.sound ?? baseCfg?.sound;
			const effects: Effect[] = [{ type: "sound", event: name, files: sound?.files, volume: sound?.volume, priority: 5 }];

			for (const light of (overwrite?.lights ?? baseCfg?.lights) ?? []) {
				effects.push({ type: "light", executor: this.re(light.executor), mode: light.mode });
			}

			const overlay = overwrite?.overlay ?? baseCfg?.overlay;
			if (overlay) effects.push({ type: "overlay", file: overlay.file, durationMs: overlay.durationMs });

			await this.effectExecutor.execute(effects);
		} catch (err) {
			this.logger.error(`Error handling ${name}:`, err);
		}
	}

	// Shorthand: resolve an ExecutorRef using the named executor map from config
	private re(ref: ExecutorRef): LightSharkExecutor {
		return resolveExecutor(ref, this.config.executors ?? {});
	}

	// Maps a throw to LightShark color effects based on colorMode config.
	// Singles leave lights unchanged (EffectExecutor cleanup on takeout resets state).
	private resolveThrowLightEffects(throwData: GameThrow): Effect[] {
		const ls = this.config.lightshark;
		if (!ls.enabled || !ls.throwEffect.enabled) return [];

		const { colorMode } = ls.throwEffect;
		const effects: Effect[] = [];

		// Miss → sound + lights come from gameEventsConfig.miss (same entry, no split config)
		if (throwData.points === 0) {
			if (this.config.knx.enabled) effects.push({ type: "knx", action: "allOff" });
			for (const light of gameEventsConfig["miss"]?.lights ?? []) {
				effects.push({ type: "light", executor: this.re(light.executor), mode: light.mode });
			}
			return effects;
		}

		if (!colorMode.enabled) return [];

		// Doubles and triples on colored segments
		if (throwData.multiplier >= 2) {
			const isRed = colorMode.redSegments.includes(throwData.segment);
			const isGreen = colorMode.greenSegments.includes(throwData.segment);
			if (isRed) effects.push({ type: "light", executor: this.re(colorMode.redExecutor), mode: "main" });
			else if (isGreen) effects.push({ type: "light", executor: this.re(colorMode.greenExecutor), mode: "main" });
			// T20 also gets strobe on top
			if (throwData.segment === 20 && throwData.multiplier === 3) {
				effects.push({ type: "strobe", executor: this.re(colorMode.triple20Strobe.executor), durationMs: colorMode.triple20Strobe.durationMs });
			}
			return effects;
		}

		// Singles: release flash-mode dim if active (e.g. after a miss); color executors hold naturally
		if (this.gameState.getLastExecutor()?.flashMode) {
			effects.push({ type: "light", mode: "release" });
		}
		return effects;
	}

	// Maps a throw to its base sound event name. Special events override this via their own sound.
	private resolveThrowSoundName(throwData: GameThrow): string {
		if (throwData.points === 0) return "miss";
		if (throwData.segment === 50) return "bullseye";
		if (throwData.segment === 25) return "bull25";
		if (throwData.multiplier === 3) return `triple_${throwData.segment}`;
		if (throwData.multiplier === 2) return `double_${throwData.segment}`;
		return `single_${throwData.segment}`;
	}

	private parseAndAdjust(payload: ScoliaThrowPayload): GameThrow {
		const parsed = SectorParser.parse(payload.sector);
		let throwData = { ...parsed };

		// Scolia sends "Bull" for both inner and outer bull — use coordinates to distinguish.
		// Explicit "25" / "50" from the simulator are already unambiguous.
		if (payload.sector === "Bull" && parsed.segment === 25) {
			const [x, y] = payload.coordinates;
			const distance = Math.sqrt(x * x + y * y);
			if (distance <= 7) {
				throwData = { points: 50, multiplier: 1, segment: 50 };
			}
		}

		// Bounceout counts as miss
		if (payload.bounceout) {
			throwData = { points: 0, multiplier: 1, segment: 0 };
		}

		return {
			...throwData,
			timestamp: Date.now(),
			bounceout: payload.bounceout,
			coordinates: payload.coordinates,
			playedEvents: {},
		};
	}

	private multiplierSuffix(multiplier: number): string {
		if (multiplier === 3) return "T";
		if (multiplier === 2) return "D";
		return "";
	}
}
