import { ScoliaThrowPayload, GameThrow, FullConfig, Effect, ThrowEvent } from "../types/index";
import { Logger } from "../utils/Logger";
import { SectorParser } from "../utils/SectorParser";
import { GameState } from "./GameState";
import { ThrowEventResolver } from "./ThrowEventResolver";
import { SpecialEventDetector } from "./SpecialEventDetector";
import { EffectExecutor } from "./EffectExecutor";

export interface IEventOrchestrator {
	handleThrowDetected(payload: ScoliaThrowPayload): Promise<void>;
	handleTakeoutFinished(): Promise<void>;
	handleTakeoutStarted(): Promise<void>;
	handleBustDetected(): Promise<void>;
	handleLegWon(): Promise<void>;
	handleSetWon(): Promise<void>;
}

export class EventOrchestrator implements IEventOrchestrator {
	private throwEventResolver: ThrowEventResolver;
	private specialEventDetector: SpecialEventDetector;
	private effectExecutor: EffectExecutor;

	constructor(
		private gameState: GameState,
		private config: FullConfig,
		private logger: Logger,
		lightsharkController: any,
		soundController: any,
		knxController: any,
	) {
		this.throwEventResolver = new ThrowEventResolver(config.lightshark);
		this.specialEventDetector = new SpecialEventDetector();
		this.effectExecutor = new EffectExecutor(
			gameState,
			lightsharkController,
			soundController,
			knxController,
			config,
			logger,
		);
	}

	async handleThrowDetected(payload: ScoliaThrowPayload): Promise<void> {
		try {
			const throwData = this.parseAndAdjust(payload);
			this.gameState.addThrow(throwData);
			const throwIndex = this.gameState.getThrowHistory().length - 1;

			const throwEvent = this.throwEventResolver.resolve(throwData);
			const specialEvent = this.specialEventDetector.detect(
				this.gameState.getThrowHistory().slice(0, -1),
				throwData,
			);

			if (
				specialEvent &&
				!this.gameState.isEventPlayed(throwIndex, specialEvent.name)
			) {
				this.logger.success(`🎉 Special Event: ${specialEvent.name}`);
				this.gameState.markEventPlayed(throwIndex, specialEvent.name);
			}

			const effects = this.mergeEffects(throwEvent, specialEvent);
			await this.effectExecutor.execute(effects);

			this.logger.info(
				`Throw: ${throwData.segment}${this.multiplierSuffix(throwData.multiplier)} = ${throwData.points}p [${throwEvent.name}]`,
			);
		} catch (err) {
			this.logger.error("Error handling throw:", err);
		}
	}

	async handleTakeoutFinished(): Promise<void> {
		try {
			this.logger.info("Takeout finished - resetting state");
			await this.effectExecutor.execute([{ type: "sound", event: "takeout" }]);
			await this.effectExecutor.cleanup();
			this.gameState.reset();
		} catch (err) {
			this.logger.error("Error handling takeout:", err);
		}
	}

	async handleTakeoutStarted(): Promise<void> {
		this.logger.info("Takeout started");
	}

	async handleBustDetected(): Promise<void> {
		try {
			this.logger.info("Bust detected");
			await this.effectExecutor.execute([{ type: "sound", event: "bust", priority: 5 }]);
		} catch (err) {
			this.logger.error("Error handling bust:", err);
		}
	}

	async handleLegWon(): Promise<void> {
		try {
			this.logger.info("Leg won");
			await this.effectExecutor.execute([{ type: "sound", event: "leg_won", priority: 5 }]);
		} catch (err) {
			this.logger.error("Error handling leg won:", err);
		}
	}

	async handleSetWon(): Promise<void> {
		try {
			this.logger.info("Set won");
			await this.effectExecutor.execute([{ type: "sound", event: "set_won", priority: 5 }]);
		} catch (err) {
			this.logger.error("Error handling set won:", err);
		}
	}

	// Special sound replaces throw sound; all other effects stack.
	private mergeEffects(throwEvent: ThrowEvent, special: ThrowEvent | null): Effect[] {
		if (!special) return throwEvent.effects;
		const specialHasSound = special.effects.some((e) => e.type === "sound");
		const base = specialHasSound
			? throwEvent.effects.filter((e) => e.type !== "sound")
			: throwEvent.effects;
		return [...base, ...special.effects];
	}

	private parseAndAdjust(payload: ScoliaThrowPayload): GameThrow {
		const parsed = SectorParser.parse(payload.sector);
		let throwData = { ...parsed };

		// Distinguish inner bull (50p) from outer bull (25p) via coordinates
		if (parsed.segment === 25) {
			const [x, y] = payload.coordinates;
			const distance = Math.sqrt(x * x + y * y);
			if (distance <= 7) {
				throwData = { points: 50, multiplier: 1, segment: 50 };
			}
		}

		// Bounceout counts as miss
		if (payload.bounceout) {
			throwData = { points: 0, multiplier: 0, segment: 0 };
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
