import { SpecialEventDetector } from "../../src/core/SpecialEventDetector";
import { GameThrow, SpecialEventDefinition } from "../../src/types/index";

const testEventDefs: SpecialEventDefinition[] = [
	{
		name: "180",
		enabled: true,
		priority: 3,
		detector: "sumLastN",
		params: { n: 3, targetSum: 180 },
		lights: [
			{ executor: { page: 1, column: 6, row: 2 }, mode: "additive" },
			{ executor: { page: 1, column: 7, row: 2 }, mode: "additive" },
		],
	},
	{
		name: "120",
		enabled: true,
		priority: 3,
		detector: "consecutivePattern",
		params: { pattern: [60, 60] },
		sound: { files: ["core/one_twenty.wav"] },
	},
	{
		name: "123",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s2", "s3"] },
		sound: { files: ["core/one_two_three.wav"] },
	},
	{
		name: "111",
		enabled: true,
		priority: 1,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s1"] },
		sound: { files: ["core/three_ones.wav"] },
	},
	{
		name: "007",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["None", "None", "s7"] },
		sound: { files: ["core/double_oh_seven.wav"] },
	},
	{
		name: "1337",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1337 },
		sound: { files: ["core/1337.wav"] },
	},
	{
		name: "1904",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1904 },
		sound: { files: ["core/nineteen_oh_four.wav"] },
	},
	{
		name: "404",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 404 },
		sound: { files: ["core/four_oh_four.wav"] },
	},
	{
		name: "three_misses",
		enabled: true,
		priority: 2,
		detector: "consecutiveMisses",
		params: { count: 3 },
		sound: { files: ["core/three_misses.wav"] },
	},
];

describe("SpecialEventDetector", () => {
	let detector: SpecialEventDetector;

	beforeEach(() => {
		detector = new SpecialEventDetector(testEventDefs);
	});

	const createThrow = (
		points: number,
		segment: number,
		multiplier: number,
	): GameThrow => ({
		points,
		segment,
		multiplier,
		timestamp: Date.now(),
		playedEvents: {},
	});

	describe("180 Detection", () => {
		it("should detect 180 (sum of last 3 throws)", () => {
			const history: GameThrow[] = [
				createThrow(60, 20, 3), // T20 = 60
				createThrow(60, 20, 3), // T20 = 60
			];
			const current = createThrow(60, 20, 3); // T20 = 60

			const result = detector.detect(history, current);

			expect(result).not.toBeNull();
			expect(result?.name).toBe("180");
		});

		it("should not detect 180 with different sum", () => {
			const history: GameThrow[] = [
				createThrow(60, 20, 3),
				createThrow(50, 25, 1),
			];
			const current = createThrow(60, 20, 3);

			const result = detector.detect(history, current);

			// Should not be 180
			expect(result?.name).not.toBe("180");
		});

		it("should not detect 180 with insufficient throws", () => {
			const history: GameThrow[] = [createThrow(60, 20, 3)];
			const current = createThrow(120, 0, 0);

			const result = detector.detect(history, current);

			// Not enough history
			expect(result?.name).not.toBe("180");
		});
	});

	describe("120 Detection", () => {
		it("should detect 120 (two consecutive T20s)", () => {
			const history: GameThrow[] = [createThrow(60, 20, 3)]; // T20 = 60
			const current = createThrow(60, 20, 3); // T20 = 60

			const result = detector.detect(history, current);

			expect(result?.name).toBe("120");
		});

		it("should not detect 120 with only one T20", () => {
			const history: GameThrow[] = [createThrow(20, 20, 1)]; // S20 = 20
			const current = createThrow(60, 20, 3); // T20 = 60

			const result = detector.detect(history, current);

			expect(result?.name).not.toBe("120");
		});
	});

	describe("1-2-3 Detection", () => {
		it("should detect 1-2-3 sequence", () => {
			const history: GameThrow[] = [
				createThrow(1, 1, 1), // S1
				createThrow(2, 2, 1), // S2
			];
			const current = createThrow(3, 3, 1); // S3

			const result = detector.detect(history, current);

			expect(result?.name).toBe("123");
		});

		it("should not detect 1-2-3 with doubles", () => {
			const history: GameThrow[] = [
				createThrow(2, 1, 2), // D1
				createThrow(4, 2, 2), // D2
			];
			const current = createThrow(6, 3, 2); // D3

			const result = detector.detect(history, current);

			expect(result?.name).not.toBe("123");
		});
	});

	describe("Three Ones Detection", () => {
		it("should detect three consecutive single 1s", () => {
			const history: GameThrow[] = [createThrow(1, 1, 1), createThrow(1, 1, 1)];
			const current = createThrow(1, 1, 1);

			const result = detector.detect(history, current);

			expect(result?.name).toBe("111");
		});
	});

	describe("007 Detection", () => {
		it("should detect 007 (miss, miss, single 7)", () => {
			const history: GameThrow[] = [
				createThrow(0, 0, 1), // Miss
				createThrow(0, 0, 1), // Miss
			];
			const current = createThrow(7, 7, 1); // S7

			const result = detector.detect(history, current);

			expect(result?.name).toBe("007");
		});

		it("should not detect 007 with different segment", () => {
			const history: GameThrow[] = [createThrow(0, 0, 1), createThrow(0, 0, 1)];
			const current = createThrow(3, 3, 1); // S3, not S7

			const result = detector.detect(history, current);

			expect(result?.name).not.toBe("007");
		});
	});

	describe("1337 Detection (concatenatesTo)", () => {
		it("should detect 1337 with s13, s3, s7", () => {
			const history: GameThrow[] = [
				createThrow(13, 13, 1), // S13
				createThrow(3, 3, 1),  // S3
			];
			const current = createThrow(7, 7, 1); // S7

			const result = detector.detect(history, current);

			expect(result?.name).toBe("1337");
		});

		it("should detect 1337 with s1, T11 (33p), s7", () => {
			const history: GameThrow[] = [
				createThrow(1, 1, 1),   // S1
				createThrow(33, 11, 3), // T11 = 33p
			];
			const current = createThrow(7, 7, 1); // S7

			const result = detector.detect(history, current);

			expect(result?.name).toBe("1337");
		});
	});

	describe("19-04 Detection (concatenatesTo)", () => {
		it("should detect 1904 (19p, miss, 4p)", () => {
			const history: GameThrow[] = [
				createThrow(19, 19, 1), // S19
				createThrow(0, 0, 1),  // Miss
			];
			const current = createThrow(4, 4, 1); // S4

			const result = detector.detect(history, current);

			expect(result?.name).toBe("1904");
		});

		it("should detect 1904 with d2 as the final 4p throw", () => {
			const history: GameThrow[] = [
				createThrow(19, 19, 1), // S19
				createThrow(0, 0, 1),  // Miss
			];
			const current = createThrow(4, 2, 2); // D2 = 4p

			const result = detector.detect(history, current);

			expect(result?.name).toBe("1904");
		});
	});

	describe("404 Detection (concatenatesTo)", () => {
		it("should detect 404 (4p, miss, 4p)", () => {
			const history: GameThrow[] = [
				createThrow(4, 4, 1), // S4
				createThrow(0, 0, 1), // Miss
			];
			const current = createThrow(4, 4, 1); // S4

			const result = detector.detect(history, current);

			expect(result?.name).toBe("404");
		});

		it("should detect 404 with d2 (also 4p)", () => {
			const history: GameThrow[] = [
				createThrow(4, 2, 2), // D2 = 4p
				createThrow(0, 0, 1), // Miss
			];
			const current = createThrow(4, 4, 1); // S4

			const result = detector.detect(history, current);

			expect(result?.name).toBe("404");
		});
	});

	describe("Three Misses Detection", () => {
		it("should detect three consecutive misses", () => {
			const history: GameThrow[] = [createThrow(0, 0, 1), createThrow(0, 0, 1)];
			const current = createThrow(0, 0, 1);

			const result = detector.detect(history, current);

			expect(result?.name).toBe("three_misses");
		});
	});

	describe("Pattern Priority", () => {
		it("should return first matching pattern", () => {
			// This is 1-2-3 which should match before other patterns
			const history: GameThrow[] = [createThrow(1, 1, 1), createThrow(2, 2, 1)];
			const current = createThrow(3, 3, 1);

			const result = detector.detect(history, current);

			expect(result?.name).toBe("123");
		});
	});

	describe("No Match", () => {
		it("should return null for non-matching patterns", () => {
			const history: GameThrow[] = [
				createThrow(20, 20, 1), // S20
				createThrow(30, 15, 2), // D15
			];
			const current = createThrow(25, 25, 1); // S25 (invalid segment, but for testing)

			const result = detector.detect(history, current);

			expect(result).toBeNull();
		});

		it("should handle empty history", () => {
			const current = createThrow(60, 20, 3);

			const result = detector.detect([], current);

			expect(result).toBeNull();
		});
	});

	describe("Special Events Config", () => {
		it("should have 180 enabled with light effects and no sound files", () => {
			const history: GameThrow[] = [
				createThrow(60, 20, 3),
				createThrow(60, 20, 3),
			];
			const current = createThrow(60, 20, 3);

			const result = detector.detect(history, current);

			expect(result?.name).toBe("180");
			expect(result?.effects.some((e) => e.type === "light")).toBe(true);
			// Sound effect is always emitted; 180 in testEventDefs has no files (falls back to core/)
			const soundEffect = result?.effects.find((e) => e.type === "sound") as any;
			expect(soundEffect).toBeDefined();
			expect(soundEffect?.files).toBeUndefined();
		});

		it("should have sound effect configured for special events", () => {
			const history: GameThrow[] = [createThrow(1, 1, 1), createThrow(2, 2, 1)];
			const current = createThrow(3, 3, 1);

			const result = detector.detect(history, current);

			const soundEffect = result?.effects.find((e) => e.type === "sound") as any;
			expect(soundEffect?.event).toBe("123");
		});
	});
});
