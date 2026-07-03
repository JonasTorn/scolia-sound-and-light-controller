import { EffectResolution, GameThrow, LightSharkConfig } from "../types/index";

export class EffectResolver {
	constructor(private lightsharkConfig: LightSharkConfig) {}

	resolve(throwData: GameThrow): EffectResolution {
		const { points, multiplier, segment } = throwData;
		const cfg = this.lightsharkConfig.throwEffect;

		// Miss (0 points)
		if (points === 0) {
			return {
				executor: cfg.noScoreExecutor,
				effectName: "miss",
				hasStrobe: false,
				strobeExecutor: null,
				strobeDurationMs: 0,
			};
		}

		// Bullseye (50 points)
		if (segment === 50) {
			return {
				executor: cfg.colorMode.bullseyeExecutor,
				effectName: "bullseye",
				hasStrobe: true,
				strobeExecutor: cfg.colorMode.triple20Strobe?.executor ?? null,
				strobeDurationMs: cfg.colorMode.triple20Strobe?.durationMs ?? 0,
			};
		}

		// Bull (25 points)
		if (segment === 25) {
			const executor =
				cfg.colorMode.bull25 === "red"
					? cfg.colorMode.redExecutor
					: cfg.colorMode.greenExecutor;
			return {
				executor,
				effectName: "bull25",
				hasStrobe: false,
				strobeExecutor: null,
				strobeDurationMs: 0,
			};
		}

		// Triple 20 (60 points)
		if (segment === 20 && multiplier === 3) {
			return {
				executor: cfg.colorMode.redExecutor,
				effectName: "triple_20",
				hasStrobe: true,
				strobeExecutor: cfg.colorMode.triple20Strobe?.executor ?? null,
				strobeDurationMs: cfg.colorMode.triple20Strobe?.durationMs ?? 0,
			};
		}

		// Colored segments (red or green based on segment)
		if (multiplier === 2 || multiplier === 3) {
			const isRed = cfg.colorMode.redSegments.includes(segment);
			const executor = isRed
				? cfg.colorMode.redExecutor
				: cfg.colorMode.greenExecutor;
			return {
				executor,
				effectName:
					multiplier === 3 ? `triple_${segment}` : `double_${segment}`,
				hasStrobe: false,
				strobeExecutor: null,
				strobeDurationMs: 0,
			};
		}

		// Single or default - no executor trigger (KNX handles lights on/off)
		return {
			executor: null,
			effectName: `single_${segment}`,
			hasStrobe: false,
			strobeExecutor: null,
			strobeDurationMs: 0,
		};
	}
}
