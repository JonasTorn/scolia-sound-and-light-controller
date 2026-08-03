import { Effect, FullConfig, LightSharkExecutor } from "../types/index";
import { GameState } from "./GameState";
import { Logger } from "../utils/Logger";

export class EffectExecutor {
	private strobeTimer: NodeJS.Timeout | null = null;
	private activeStrobeExecutor: LightSharkExecutor | null = null;

	constructor(
		private gameState: GameState,
		private lightshark: any,
		private sound: any,
		private knx: any,
		private config: FullConfig,
		private logger: Logger,
	) {}

	async execute(effects: Effect[]): Promise<void> {
		for (const effect of effects) {
			switch (effect.type) {
				case "sound":
					await this.executeSound(effect);
					break;
				case "light":
					await this.executeLight(effect);
					break;
				case "strobe":
					await this.executeStrobe(effect);
					break;
				case "knx":
					await this.executeKnx(effect);
					break;
			}
		}
	}

	// Toggle off all active lights and strobe, KNX recover. Called on takeout.
	async cleanup(): Promise<void> {
		if (this.strobeTimer) {
			clearTimeout(this.strobeTimer);
			this.strobeTimer = null;
			if (this.config.lightshark.enabled && this.activeStrobeExecutor) {
				await this.lightshark.triggerExecutor(this.activeStrobeExecutor);
				this.gameState.setStrobeActive(false);
			}
			this.activeStrobeExecutor = null;
		}

		if (this.config.lightshark.enabled) {
			for (const executor of this.gameState.getSpecialExecutors()) {
				await this.lightshark.triggerExecutor(executor);
			}
			this.gameState.clearSpecialExecutors();

			const lastExecutor = this.gameState.getLastExecutor();
			if (lastExecutor) {
				await this.lightshark.triggerExecutor(lastExecutor);
				this.gameState.setLastExecutor(null);
			}
		}

		if (this.config.knx.enabled && this.gameState.getKNXState() === "off") {
			this.knx.triggerAction("allOn");
			this.gameState.setKNXState("on");
		}
	}

	private async executeSound(
		effect: Extract<Effect, { type: "sound" }>,
	): Promise<void> {
		if (this.config.sound.enabled) {
			await this.sound.playSound(effect.event, effect.priority ?? 0, effect.files, effect.volume, effect.playerSounds);
		}
	}

	private async executeLight(
		effect: Extract<Effect, { type: "light" }>,
	): Promise<void> {
		if (!this.config.lightshark.enabled) return;

		if (effect.mode === "main") {
			// Toggle off previous main light if different
			const last = this.gameState.getLastExecutor();
			if (last && !this.executorEquals(last, effect.executor)) {
				await this.lightshark.triggerExecutor(last);
				this.logger.debug(`Toggled off previous executor: ${JSON.stringify(last)}`);
			}
			await this.lightshark.triggerExecutor(effect.executor);
			this.gameState.setLastExecutor(effect.executor);
		} else {
			// Additive: trigger and track for cleanup
			await this.lightshark.triggerExecutor(effect.executor);
			this.gameState.addSpecialExecutor(effect.executor);
		}
	}

	private async executeStrobe(
		effect: Extract<Effect, { type: "strobe" }>,
	): Promise<void> {
		if (!this.config.lightshark.enabled) return;

		// Clear previous strobe first
		if (this.strobeTimer) {
			clearTimeout(this.strobeTimer);
			this.strobeTimer = null;
			await this.lightshark.triggerExecutor(effect.executor); // toggle off
		}

		await this.lightshark.triggerExecutor(effect.executor);
		this.gameState.setStrobeActive(true);
		this.activeStrobeExecutor = effect.executor;

		this.strobeTimer = setTimeout(async () => {
			await this.lightshark.triggerExecutor(effect.executor);
			this.gameState.setStrobeActive(false);
			this.activeStrobeExecutor = null;
			this.strobeTimer = null;
			this.logger.debug(`Strobe auto-off after ${effect.durationMs}ms`);
		}, effect.durationMs);
	}

	private async executeKnx(
		effect: Extract<Effect, { type: "knx" }>,
	): Promise<void> {
		if (!this.config.knx.enabled) return;

		if (effect.action === "allOn" && this.gameState.getKNXState() !== "off") {
			return; // lights already on, skip
		}

		this.knx.triggerAction(effect.action);

		if (effect.action === "allOff") this.gameState.setKNXState("off");
		if (effect.action === "allOn") this.gameState.setKNXState("on");
	}

	private executorEquals(a: LightSharkExecutor, b: LightSharkExecutor): boolean {
		return a.page === b.page && a.column === b.column && a.row === b.row;
	}
}
