import { Effect, FullConfig, IKNXController, ILightSharkController, IPlaywrightController, ISoundController, LightSharkExecutor } from "../types/index";
import { GameState } from "./GameState";
import { Logger } from "../utils/Logger";

type StrobeEntry = { timer: NodeJS.Timeout; executor: LightSharkExecutor; fired: boolean };

export class EffectExecutor {
	private strobeEntries: Map<string, StrobeEntry> = new Map();

	constructor(
		private gameState: GameState,
		private lightshark: ILightSharkController,
		private sound: ISoundController,
		private knx: IKNXController,
		private config: FullConfig,
		private logger: Logger,
		private playwright?: IPlaywrightController,
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
				case "overlay":
					await this.playwright?.showOverlay(effect.file, effect.durationMs);
					break;
			}
		}
	}

	// Toggle off all active lights and strobe, KNX recover. Called on takeout.
	async cleanup(): Promise<void> {
		// Cancel all strobe timers and turn off any that haven't auto-fired yet
		for (const entry of this.strobeEntries.values()) {
			clearTimeout(entry.timer);
			if (this.config.lightshark.enabled && !entry.fired) {
				await this.lightshark.triggerExecutor(entry.executor);
			}
		}
		this.strobeEntries.clear();
		this.gameState.setStrobeActive(false);

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
		if (!this.config.sound.enabled) return;
		if (effect.isThrowSound && this.config.sound.throwSoundsEnabled === false) return;
		await this.sound.playSound(effect.event, effect.priority ?? 0, effect.files, effect.volume);
	}

	private async executeLight(
		effect: Extract<Effect, { type: "light" }>,
	): Promise<void> {
		if (!this.config.lightshark.enabled) return;

		if (effect.mode === "release") {
			const last = this.gameState.getLastExecutor();
			if (last) {
				await this.lightshark.triggerExecutor(last); // 0.0 = Flash stop or toggle-off
				this.gameState.setLastExecutor(null);
			}
			return;
		}

		if (effect.mode === "main") {
			const last = this.gameState.getLastExecutor();
			// Same executor already active — skip to avoid double-toggle (toggle-off would turn it off)
			if (last && this.executorEquals(last, effect.executor)) return;
			// Deactivate previous main light (0.0 = toggle-off for Toggle mode, stop for Flash mode)
			if (last) {
				await this.lightshark.triggerExecutor(last);
				this.logger.debug(`Deactivated previous executor: ${JSON.stringify(last)}`);
			}
			// Activate: Flash mode sends 1.0 (explicit go), Toggle mode sends 0.0 (toggle on)
			if (effect.executor.flashMode) {
				await this.lightshark.startExecutor(effect.executor);
			} else {
				await this.lightshark.triggerExecutor(effect.executor);
			}
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

		const key = `${effect.executor.page}/${effect.executor.column}/${effect.executor.row}`;

		// If this executor already has a running timer, cancel it (restart the duration)
		const existing = this.strobeEntries.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			this.strobeEntries.delete(key);
		}

		// Flash mode: 1.0 to start (idempotent). Toggle mode: 0.0 to toggle on.
		if (effect.executor.flashMode) {
			await this.lightshark.startExecutor(effect.executor);
		} else {
			await this.lightshark.triggerExecutor(effect.executor);
		}
		this.gameState.setStrobeActive(true);

		const entry: StrobeEntry = {
			executor: effect.executor,
			fired: false,
			timer: setTimeout(async () => {
				entry.fired = true;
				this.strobeEntries.delete(key);
				await this.lightshark.triggerExecutor(effect.executor);
				if (this.strobeEntries.size === 0) this.gameState.setStrobeActive(false);
				this.logger.debug(`Strobe auto-off after ${effect.durationMs}ms`);
			}, effect.durationMs),
		};
		this.strobeEntries.set(key, entry);
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
