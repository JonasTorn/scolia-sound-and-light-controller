import { Effect, GameThrow, LightSharkConfig, ThrowEvent } from "../types/index";

export class ThrowEventResolver {
	constructor(private lightsharkConfig: LightSharkConfig) {}

	resolve(throwData: GameThrow): ThrowEvent {
		const { points, multiplier, segment } = throwData;
		const cfg = this.lightsharkConfig.throwEffect;

		if (points === 0) {
			return {
				name: "miss",
				effects: [
					{ type: "sound", event: "miss" },
					{ type: "light", executor: cfg.noScoreExecutor, mode: "main" },
					{ type: "knx", action: "allOff" },
				],
			};
		}

		if (segment === 50) {
			const effects: Effect[] = [
				{ type: "sound", event: "bullseye" },
				{ type: "light", executor: cfg.colorMode.bullseyeExecutor, mode: "main" },
			];
			if (cfg.colorMode.triple20Strobe) {
				effects.push({
					type: "strobe",
					executor: cfg.colorMode.triple20Strobe.executor,
					durationMs: cfg.colorMode.triple20Strobe.durationMs,
				});
			}
			return { name: "bullseye", effects };
		}

		if (segment === 25) {
			const executor =
				cfg.colorMode.bull25 === "red"
					? cfg.colorMode.redExecutor
					: cfg.colorMode.greenExecutor;
			return {
				name: "bull25",
				effects: [
					{ type: "sound", event: "bull25" },
					{ type: "light", executor, mode: "main" },
				],
			};
		}

		if (segment === 20 && multiplier === 3) {
			const effects: Effect[] = [
				{ type: "sound", event: "triple_20" },
				{ type: "light", executor: cfg.colorMode.redExecutor, mode: "main" },
			];
			if (cfg.colorMode.triple20Strobe) {
				effects.push({
					type: "strobe",
					executor: cfg.colorMode.triple20Strobe.executor,
					durationMs: cfg.colorMode.triple20Strobe.durationMs,
				});
			}
			return { name: "triple_20", effects };
		}

		if (multiplier >= 2) {
			const isRed = cfg.colorMode.redSegments.includes(segment);
			const executor = isRed
				? cfg.colorMode.redExecutor
				: cfg.colorMode.greenExecutor;
			const prefix = multiplier === 3 ? "triple" : "double";
			const name = `${prefix}_${segment}`;
			return {
				name,
				effects: [
					{ type: "sound", event: name },
					{ type: "light", executor, mode: "main" },
				],
			};
		}

		// Singles: no light effect; KNX allOn recovers from miss state
		const singleName = `single_${segment}`;
		return {
			name: singleName,
			effects: [
				{ type: "sound", event: singleName },
				{ type: "knx", action: "allOn" },
			],
		};
	}
}
