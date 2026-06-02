import {
	ScoliaThrowPayload,
	GameThrow,
	FullConfig,
	LightSharkExecutor,
} from "../types/index";
import { Logger } from "../utils/Logger";
import { SectorParser } from "../utils/SectorParser";
import { GameState } from "./GameState";
import { EffectResolver } from "./EffectResolver";
import { SpecialEventDetector } from "./SpecialEventDetector";

export interface IEventOrchestrator {
	handleThrowDetected(payload: ScoliaThrowPayload): Promise<void>;
	handleTakeoutFinished(): Promise<void>;
	handleTakeoutStarted(): Promise<void>;
}

export class EventOrchestrator implements IEventOrchestrator {
	private effectResolver: EffectResolver;
	private specialEventDetector: SpecialEventDetector;

	constructor(
		private gameState: GameState,
		private config: FullConfig,
		private logger: Logger,
		private lightsharkController: any, // Will be properly typed in Phase 3
		private soundController: any,
		private knxController: any,
	) {
		this.effectResolver = new EffectResolver(config.lightshark);
		this.specialEventDetector = new SpecialEventDetector();
	}

	async handleThrowDetected(payload: ScoliaThrowPayload): Promise<void> {
		try {
			// 1. Parse sector
			const parsed = SectorParser.parse(payload.sector);

			// 2. Adjust bull inner/outer based on coordinates
			const throwData = this.adjustBullType(parsed, payload);

			// 3. Handle bounceout as miss
			if (payload.bounceout) {
				throwData.points = 0;
				throwData.segment = 0;
				throwData.multiplier = 0;
			}

			// 4. Add to game state
			const gameThrow: GameThrow = {
				...throwData,
				timestamp: Date.now(),
				bounceout: payload.bounceout,
				coordinates: payload.coordinates,
				playedEvents: {},
			};

			this.gameState.addThrow(gameThrow);
			const throwIndex = this.gameState.getThrowHistory().length - 1;

			// 5. Resolve throw effect
			const effect = this.effectResolver.resolve(gameThrow);

			// 6. Trigger main executor (toggle off previous, then on new)
			if (effect.executor) {
				const lastExecutor = this.gameState.getLastExecutor();
				if (
					lastExecutor &&
					!this.executorEquals(lastExecutor, effect.executor)
				) {
					// Toggle off previous executor
					await this.lightsharkController.triggerExecutor(lastExecutor);
					this.logger.debug(
						`Toggled off previous executor: ${JSON.stringify(lastExecutor)}`,
					);
				}

				// Trigger new executor
				await this.lightsharkController.triggerExecutor(effect.executor);
				this.gameState.setLastExecutor(effect.executor);
				this.logger.debug(
					`Triggered executor: ${JSON.stringify(effect.executor)}`,
				);
			}

			// 7. Handle strobe overlay (T20 or Bullseye)
			if (effect.hasStrobe && effect.strobeExecutor) {
				// Clear any previous strobe
				if (this.gameState.isStrobeActive()) {
					await this.lightsharkController.triggerExecutor(
						effect.strobeExecutor,
					);
				}

				// Trigger new strobe
				await this.lightsharkController.triggerExecutor(effect.strobeExecutor);
				this.gameState.setStrobeActive(true);

				// Schedule auto-off
				setTimeout(async () => {
					await this.lightsharkController.triggerExecutor(
						effect.strobeExecutor!,
					);
					this.gameState.setStrobeActive(false);
					this.logger.debug(
						`Strobe auto-off after ${effect.strobeDurationMs}ms`,
					);
				}, effect.strobeDurationMs);
			}

			// 8. KNX logic
			if (gameThrow.points === 0) {
				// Miss: turn off lights
				if (this.config.knx.enabled) {
					await this.knxController.triggerAction("allOff");
					this.gameState.setKNXState("off");
					this.logger.debug("KNX allOff (miss)");
				}
			} else if (this.gameState.getKNXState() === "off" && !effect.executor) {
				// Non-zero throw after miss: turn on lights (only for singles, not colored effects)
				if (this.config.knx.enabled) {
					await this.knxController.triggerAction("allOn");
					this.gameState.setKNXState("on");
					this.logger.debug("KNX allOn (recovery from miss)");
				}
			}

			// 9. Check special events
			const specialEvent = this.specialEventDetector.detect(
				this.gameState.getThrowHistory().slice(0, -1),
				gameThrow,
			);

			if (
				specialEvent &&
				!this.gameState.isEventPlayed(throwIndex, specialEvent.eventName)
			) {
				this.logger.success(`🎉 Special Event: ${specialEvent.eventName}`);
				this.gameState.markEventPlayed(throwIndex, specialEvent.eventName);

				// Trigger special event effects
				for (const eff of specialEvent.effects) {
					if (eff.type === "lightshark" && eff.executor) {
						await this.lightsharkController.triggerExecutor(eff.executor);
						this.gameState.addSpecialExecutor(eff.executor);
					}
				}
			}

			// 10. Play sound
			if (specialEvent && specialEvent.sound) {
				await this.soundController.playSound(specialEvent.sound);
			} else {
				// Fall back to throw-based sounds
				const soundName = this.resolveSoundName(gameThrow);
				if (soundName) {
					await this.soundController.playSound(soundName);
				}
			}

			this.logger.info(
				`Throw: ${gameThrow.segment}${this.multiplierSuffix(gameThrow.multiplier)} = ${gameThrow.points}p [${effect.effectName}]`,
			);
		} catch (err) {
			this.logger.error("Error handling throw:", err);
		}
	}

	async handleTakeoutFinished(): Promise<void> {
		try {
			this.logger.info("Takeout finished - resetting state");

			// 1. Play takeout sound
			if (this.config.sound.enabled) {
				await this.soundController.playSound("takeout");
			}

			// 2. Turn off strobe if active
			if (this.gameState.isStrobeActive()) {
				const strobeExecutor =
					this.config.lightshark.throwEffect.colorMode.triple20Strobe.executor;
				await this.lightsharkController.triggerExecutor(strobeExecutor);
				this.gameState.setStrobeActive(false);
			}

			// 3. Disable special executors (180 effects)
			const specialExecutors = this.gameState.getSpecialExecutors();
			for (const executor of specialExecutors) {
				await this.lightsharkController.triggerExecutor(executor);
			}
			this.gameState.clearSpecialExecutors();

			// 4. Toggle off last triggered executor
			const lastExecutor = this.gameState.getLastExecutor();
			if (lastExecutor) {
				await this.lightsharkController.triggerExecutor(lastExecutor);
				this.gameState.setLastExecutor(null);
			}

			// 5. Turn on lights if they were off
			if (this.config.knx.enabled && this.gameState.getKNXState() === "off") {
				await this.knxController.triggerAction("allOn");
				this.gameState.setKNXState("on");
				this.logger.debug("KNX allOn (takeout recovery)");
			}

			// 6. Reset game state
			this.gameState.reset();
		} catch (err) {
			this.logger.error("Error handling takeout:", err);
		}
	}

	async handleTakeoutStarted(): Promise<void> {
		this.logger.info("Takeout started");
	}

	private adjustBullType(parsed: any, payload: ScoliaThrowPayload): any {
		if (parsed.segment !== 25) return parsed;

		// Distinguish inner bull (50p) from outer bull (25p) via coordinates
		const [x, y] = payload.coordinates;
		const distance = Math.sqrt(x * x + y * y);

		if (distance <= 7) {
			// Inner bull = bullseye (50p)
			return { points: 50, multiplier: 1, segment: 50 };
		}

		return parsed;
	}

	private resolveSoundName(throwData: GameThrow): string | null {
		const { points, multiplier, segment } = throwData;

		if (points === 0) return "miss";
		if (segment === 50) return "bullseye";
		if (segment === 25) return "bull25";

		if (multiplier === 3) {
			// Segment-specific triple sounds with fallback
			const specificSounds: Record<number, string> = {
				20: "triple_20",
				19: "triple_19",
				18: "triple_18",
				17: "triple_17",
				7: "triple_7",
			};
			return specificSounds[segment] || "triple";
		}

		if (multiplier === 2) {
			return "double";
		}

		if (multiplier === 1 && segment === 1) {
			return "single_1";
		}

		return null;
	}

	private multiplierSuffix(multiplier: number): string {
		if (multiplier === 3) return "T";
		if (multiplier === 2) return "D";
		return "";
	}

	private executorEquals(
		a: LightSharkExecutor,
		b: LightSharkExecutor,
	): boolean {
		return a.page === b.page && a.column === b.column && a.row === b.row;
	}
}
