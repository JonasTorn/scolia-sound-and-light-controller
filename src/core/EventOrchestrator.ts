import { ScoliaThrowPayload, GameThrow, FullConfig, Effect, ThrowEvent, ILightSharkController, ISoundController, IKNXController } from "../types/index";
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
	handlePlayerEliminated(): Promise<void>;
}

export class EventOrchestrator implements IEventOrchestrator {
	private throwEventResolver: ThrowEventResolver;
	private specialEventDetector: SpecialEventDetector;
	private effectExecutor: EffectExecutor;

	constructor(
		private gameState: GameState,
		private config: FullConfig,
		private logger: Logger,
		lightsharkController: ILightSharkController,
		soundController: ISoundController,
		knxController: IKNXController,
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
			this.logger.info("Takeout finished");
			await this.effectExecutor.execute([{ type: "sound", event: "takeout" }]);
			await this.effectExecutor.cleanup();
		} catch (err) {
			this.logger.error("Error handling takeout:", err);
		}
	}

	async handleTakeoutStarted(): Promise<void> {
		this.logger.info("Takeout started - resetting state");
		this.gameState.reset();
	}

	async handleBustDetected(): Promise<void>     { await this.fireGameEvent("bust", "Bust detected"); }
	async handleLegWon(): Promise<void>           { await this.fireGameEvent("leg_won", "Leg won"); }
	async handleSetWon(): Promise<void>           { await this.fireGameEvent("set_won", "Set won"); }
	async handlePlayerEliminated(): Promise<void> { await this.fireGameEvent("eliminated", "Player eliminated"); }

	private async fireGameEvent(name: string, logMsg: string): Promise<void> {
		try {
			this.logger.info(logMsg);
			await this.effectExecutor.execute([{ type: "sound", event: name, priority: 5 }]);
		} catch (err) {
			this.logger.error(`Error handling ${name}:`, err);
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
