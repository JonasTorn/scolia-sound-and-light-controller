import { LightSharkConfig, GameThrow, Effect } from "../types/index";

export class ThrowEventResolver {
	constructor(private config: LightSharkConfig) {}

	resolve(throwData: GameThrow): { name: string; effects: Effect[] } {
		const name = this.resolveName(throwData);
		const effects: Effect[] = [
			{ type: "sound", isThrowSound: true, event: name },
			...this.resolveLight(throwData),
		];
		return { name, effects };
	}

	private resolveName(throwData: GameThrow): string {
		if (throwData.points === 0) return "miss";
		if (throwData.segment === 50) return "bullseye";
		if (throwData.segment === 25) return "bull25";
		if (throwData.multiplier === 3) return `triple_${throwData.segment}`;
		if (throwData.multiplier === 2) return `double_${throwData.segment}`;
		return `single_${throwData.segment}`;
	}

	private resolveLight(throwData: GameThrow): Effect[] {
		if (!this.config.enabled || !this.config.throwEffect.enabled) return [];

		const { colorMode, noScoreExecutor } = this.config.throwEffect;
		const effects: Effect[] = [];

		if (throwData.points === 0) {
			effects.push({ type: "light", executor: noScoreExecutor, mode: "main" });
			return effects;
		}

		if (!colorMode.enabled) return [];

		if (throwData.segment === 50) {
			effects.push({ type: "light", executor: colorMode.bullseyeExecutor, mode: "main" });
			effects.push({ type: "strobe", executor: colorMode.triple20Strobe.executor, durationMs: colorMode.triple20Strobe.durationMs });
			return effects;
		}

		if (throwData.segment === 25) {
			const exec = colorMode.bull25 === "red" ? colorMode.redExecutor : colorMode.greenExecutor;
			effects.push({ type: "light", executor: exec, mode: "main" });
			return effects;
		}

		if (throwData.multiplier >= 2) {
			const isRed = colorMode.redSegments.includes(throwData.segment);
			const isGreen = colorMode.greenSegments.includes(throwData.segment);
			if (isRed) effects.push({ type: "light", executor: colorMode.redExecutor, mode: "main" });
			else if (isGreen) effects.push({ type: "light", executor: colorMode.greenExecutor, mode: "main" });
			if (throwData.segment === 20 && throwData.multiplier === 3) {
				effects.push({ type: "strobe", executor: colorMode.triple20Strobe.executor, durationMs: colorMode.triple20Strobe.durationMs });
			}
			return effects;
		}

		// Singles: no light change
		return effects;
	}
}
