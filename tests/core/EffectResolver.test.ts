import { EffectResolver } from "../../src/core/EffectResolver";
import { GameThrow, LightSharkConfig } from "../../src/types/index";

describe("EffectResolver", () => {
	let resolver: EffectResolver;
	let mockConfig: LightSharkConfig;

	beforeEach(() => {
		mockConfig = {
			enabled: true,
			ip: "192.168.1.1",
			oscPort: 8000,
			throwEffect: {
				enabled: true,
				colorMode: {
					enabled: true,
					redExecutor: { page: 1, column: 2, row: 1 },
					greenExecutor: { page: 1, column: 2, row: 2 },
					bullseyeExecutor: { page: 1, column: 6, row: 6 },
					redSegments: [20, 18, 13, 10, 2, 3, 7, 8, 14, 12],
					greenSegments: [1, 4, 6, 15, 17, 19, 16, 11, 9, 5],
					bull25: "green",
					triple20Strobe: {
						executor: { page: 1, column: 5, row: 3 },
						durationMs: 3000,
					},
				},
				noScoreExecutor: { page: 1, column: 8, row: 4 },
			},
		};

		resolver = new EffectResolver(mockConfig);
	});

	describe("Miss (0 points)", () => {
		it("should resolve miss to noScoreExecutor", () => {
			const throwData: GameThrow = {
				points: 0,
				multiplier: 0,
				segment: 0,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(mockConfig.throwEffect.noScoreExecutor);
			expect(effect.effectName).toBe("miss");
			expect(effect.hasStrobe).toBe(false);
		});
	});

	describe("Bullseye (50 points)", () => {
		it("should resolve bullseye with strobe", () => {
			const throwData: GameThrow = {
				points: 50,
				multiplier: 1,
				segment: 50,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.bullseyeExecutor,
			);
			expect(effect.effectName).toBe("bullseye");
			expect(effect.hasStrobe).toBe(true);
			expect(effect.strobeExecutor).toEqual(
				mockConfig.throwEffect.colorMode.triple20Strobe.executor,
			);
			expect(effect.strobeDurationMs).toBe(3000);
		});
	});

	describe("Bull (25 points)", () => {
		it("should resolve bull to configured executor (green)", () => {
			const throwData: GameThrow = {
				points: 25,
				multiplier: 1,
				segment: 25,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.greenExecutor,
			);
			expect(effect.effectName).toBe("bull25");
			expect(effect.hasStrobe).toBe(false);
		});
	});

	describe("Triple 20 (60 points)", () => {
		it("should resolve triple 20 with strobe", () => {
			const throwData: GameThrow = {
				points: 60,
				multiplier: 3,
				segment: 20,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.redExecutor,
			);
			expect(effect.effectName).toBe("triple_20");
			expect(effect.hasStrobe).toBe(true);
			expect(effect.strobeDurationMs).toBe(3000);
		});
	});

	describe("Colored Segments", () => {
		it("should resolve red segment to red executor", () => {
			const throwData: GameThrow = {
				points: 40,
				multiplier: 2,
				segment: 20,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.redExecutor,
			);
			expect(effect.effectName).toBe("double_20");
		});

		it("should resolve green segment to green executor", () => {
			const throwData: GameThrow = {
				points: 12,
				multiplier: 2,
				segment: 6,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.greenExecutor,
			);
			expect(effect.effectName).toBe("double_6");
		});

		it("should resolve triple red segment", () => {
			const throwData: GameThrow = {
				points: 39,
				multiplier: 3,
				segment: 13,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.redExecutor,
			);
			expect(effect.effectName).toBe("triple_13");
		});

		it("should resolve triple green segment", () => {
			const throwData: GameThrow = {
				points: 15,
				multiplier: 3,
				segment: 5,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toEqual(
				mockConfig.throwEffect.colorMode.greenExecutor,
			);
			expect(effect.effectName).toBe("triple_5");
		});
	});

	describe("Single (no executor)", () => {
		it("should resolve single without executor", () => {
			const throwData: GameThrow = {
				points: 8,
				multiplier: 1,
				segment: 8,
				timestamp: Date.now(),
				playedEvents: {},
			};

			const effect = resolver.resolve(throwData);

			expect(effect.executor).toBeNull();
			expect(effect.effectName).toBe("single_8");
			expect(effect.hasStrobe).toBe(false);
		});
	});

	describe("Effect Name Format", () => {
		it("should format effect names correctly", () => {
			const tests = [
				{ segment: 14, multiplier: 2, expected: "double_14" },
				{ segment: 19, multiplier: 3, expected: "triple_19" },
				{ segment: 11, multiplier: 1, expected: "single_11" },
			];

			tests.forEach(({ segment, multiplier, expected }) => {
				const throwData: GameThrow = {
					points: segment * multiplier,
					multiplier,
					segment,
					timestamp: Date.now(),
					playedEvents: {},
				};

				const effect = resolver.resolve(throwData);
				expect(effect.effectName).toBe(expected);
			});
		});
	});
});
