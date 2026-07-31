import { ThrowEventResolver } from "../../src/core/ThrowEventResolver";
import { GameThrow, LightSharkConfig } from "../../src/types/index";

describe("ThrowEventResolver", () => {
	let resolver: ThrowEventResolver;
	let mockConfig: LightSharkConfig;

	const redExecutor = { page: 1, column: 2, row: 1 };
	const greenExecutor = { page: 1, column: 2, row: 2 };
	const bullseyeExecutor = { page: 1, column: 6, row: 6 };
	const noScoreExecutor = { page: 1, column: 8, row: 4 };
	const strobeExecutor = { page: 1, column: 5, row: 3 };

	beforeEach(() => {
		mockConfig = {
			enabled: true,
			ip: "192.168.1.1",
			oscPort: 8000,
			throwEffect: {
				enabled: true,
				colorMode: {
					enabled: true,
					redExecutor,
					greenExecutor,
					bullseyeExecutor,
					redSegments: [20, 18, 13, 10, 2, 3, 7, 8, 14, 12],
					greenSegments: [1, 4, 6, 15, 17, 19, 16, 11, 9, 5],
					bull25: "green",
					triple20Strobe: { executor: strobeExecutor, durationMs: 3000 },
				},
				noScoreExecutor,
			},
		};

		resolver = new ThrowEventResolver(mockConfig);
	});

	const makeThrow = (points: number, segment: number, multiplier: number): GameThrow => ({
		points, segment, multiplier, timestamp: Date.now(), playedEvents: {},
	});

	const findEffect = (event: ReturnType<ThrowEventResolver["resolve"]>, type: string) =>
		event.effects.find((e) => e.type === type);

	describe("Miss (0 points)", () => {
		it("should resolve miss to noScoreExecutor with sound and KNX allOff", () => {
			const event = resolver.resolve(makeThrow(0, 0, 0));

			expect(event.name).toBe("miss");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(noScoreExecutor);
			expect(light?.mode).toBe("main");
			expect(findEffect(event, "sound")).toEqual({ type: "sound", event: "miss" });
			expect(findEffect(event, "knx")).toEqual({ type: "knx", action: "allOff" });
		});
	});

	describe("Bullseye (50 points)", () => {
		it("should resolve bullseye with strobe", () => {
			const event = resolver.resolve(makeThrow(50, 50, 1));

			expect(event.name).toBe("bullseye");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(bullseyeExecutor);
			expect(findEffect(event, "sound")).toEqual({ type: "sound", event: "bullseye" });
			const strobe = findEffect(event, "strobe") as any;
			expect(strobe?.executor).toEqual(strobeExecutor);
			expect(strobe?.durationMs).toBe(3000);
		});
	});

	describe("Bull (25 points)", () => {
		it("should resolve bull to green executor (config: green)", () => {
			const event = resolver.resolve(makeThrow(25, 25, 1));

			expect(event.name).toBe("bull25");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(greenExecutor);
			expect(findEffect(event, "sound")).toEqual({ type: "sound", event: "bull25" });
		});
	});

	describe("Triple 20 (60 points)", () => {
		it("should resolve triple 20 with red light and strobe", () => {
			const event = resolver.resolve(makeThrow(60, 20, 3));

			expect(event.name).toBe("triple_20");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(redExecutor);
			expect(light?.mode).toBe("main");
			const strobe = findEffect(event, "strobe") as any;
			expect(strobe?.durationMs).toBe(3000);
			expect(findEffect(event, "sound")).toEqual({ type: "sound", event: "triple_20" });
		});
	});

	describe("Colored Segments", () => {
		it("should resolve red segment double to red executor", () => {
			const event = resolver.resolve(makeThrow(40, 20, 2));

			expect(event.name).toBe("double_20");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(redExecutor);
			expect(findEffect(event, "sound")).toEqual({ type: "sound", event: "double_20" });
		});

		it("should resolve green segment double to green executor", () => {
			const event = resolver.resolve(makeThrow(12, 6, 2));

			expect(event.name).toBe("double_6");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(greenExecutor);
		});

		it("should resolve triple red segment", () => {
			const event = resolver.resolve(makeThrow(39, 13, 3));

			expect(event.name).toBe("triple_13");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(redExecutor);
		});

		it("should resolve triple green segment", () => {
			const event = resolver.resolve(makeThrow(15, 5, 3));

			expect(event.name).toBe("triple_5");
			const light = findEffect(event, "light") as any;
			expect(light?.executor).toEqual(greenExecutor);
		});
	});

	describe("Singles", () => {
		it("should resolve single with score sound and KNX allOn, no light", () => {
			const event = resolver.resolve(makeThrow(8, 8, 1));

			expect(event.name).toBe("single_8");
			expect(findEffect(event, "light")).toBeUndefined();
			expect(findEffect(event, "sound")).toEqual({ type: "sound", event: "single_8" });
			expect(findEffect(event, "knx")).toEqual({ type: "knx", action: "allOn" });
		});
	});

	describe("Event Name Format", () => {
		it("should format event names correctly", () => {
			const cases = [
				{ points: 28, segment: 14, multiplier: 2, expected: "double_14" },
				{ points: 57, segment: 19, multiplier: 3, expected: "triple_19" },
				{ points: 11, segment: 11, multiplier: 1, expected: "single_11" },
			];

			cases.forEach(({ points, segment, multiplier, expected }) => {
				const event = resolver.resolve(makeThrow(points, segment, multiplier));
				expect(event.name).toBe(expected);
			});
		});
	});
});
