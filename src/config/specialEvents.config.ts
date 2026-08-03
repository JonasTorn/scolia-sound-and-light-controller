import { SpecialEventDefinition } from "../types/index";

// Priority scale:
//   1 = minor fun events (two-dart combos like 21, 67, 99)
//   2 = notable combos (three-dart sequences, 007, 404, etc.)
//   3 = high-score moments (180, 120, sum-69)
//   5 = game events (bust, leg won, set won) — set in EventOrchestrator
//
// When two events match the same throw, the highest priority wins.
//
// Sound: omit the `sound` field to auto-resolve from sounds/tts/{name}.wav.
//
// Per-player sounds: add a `playerSounds` map keyed by the player's nickname
// (as shown in the Scolia web app). That player gets their own sound; everyone
// else gets the default. Example:
//
//   playerSounds: {
//     "Laser": { files: ["tts/laser_180.wav"] },
//   }
//
// Adding a new event:
//   1. Pick a detector (see SpecialEventDetector.ts for available strategies)
//   2. Add an entry below with name, detector, params
//   3. Drop a WAV file at sounds/tts/{name}.wav — done.
//   For a brand-new pattern shape, add a detector method in SpecialEventDetector.ts first.

export const specialEventsConfig: SpecialEventDefinition[] = [
	// ── High priority ────────────────────────────────────────────────────────

	{
		name: "180",
		enabled: true,
		priority: 3,
		detector: "sumLastN",
		params: { n: 3, targetSum: 180 },
		// Lights only — the spectacle is the reward
		lights: [
			{ executor: { page: 1, column: 6, row: 2 }, mode: "additive" },
			{ executor: { page: 1, column: 7, row: 2 }, mode: "additive" },
		],
	},
	{
		name: "sixty_nine_sum",
		enabled: true,
		priority: 3, // beats the consecutive 6→9 below when sum wins
		detector: "sumLastN",
		params: { n: 3, targetSum: 69 },
		sound: { files: ["tts/sixty_nine.wav"] },
	},
	{
		name: "120",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["t20", "t20"] },
	},

	// ── Notable combos ────────────────────────────────────────────────────────

	{
		name: "double_oh_seven",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["None", "None", "s7"] },
	},
	{
		name: "one_two_three",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s2", "s3"] },
	},
	{
		name: "triple_seven",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s7", "s7", "s7"] },
	},
	{
		name: "triple_seven_hit",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t7"] },
		sound: { files: ["tts/triple_seven.wav"] },
	},
	{
		name: "thirteen_thirty_seven",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s13", "s3", "s7"] },
	},
	{
		name: "nineteen_oh_four",
		enabled: true,
		priority: 2,
		detector: "nineteenOhFour",
		params: {},
	},
	{
		name: "eighteen_eighty_eight",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s18", "s8", "s8"] },
	},
	{
		name: "one_one_two",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s2"] },
	},
	{
		name: "nine_one_one",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s9", "s1", "s1"] },
	},
	{
		name: "three_sixes",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s6", "s6", "s6"] },
	},
	{
		name: "four_oh_four",
		enabled: true,
		priority: 2,
		detector: "fourOhFour",
		params: {},
	},
	{
		name: "three_misses",
		enabled: true,
		priority: 2,
		detector: "consecutiveMisses",
		params: { count: 3 },
	},

	// ── Minor fun events ─────────────────────────────────────────────────────

	{
		name: "bullseye",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["50"] },
		sound: { files: ["headshot.wav"] },
	},
	{
		name: "sixty_nine",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [6, 9] }, // any 6-pt throw → any 9-pt throw
		sound: { files: ["tts/sixty_nine.wav"] },
	},
	{
		name: "three_ones",
		enabled: true,
		priority: 1,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s1"] },
	},
	{
		name: "four_twenty",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [4, 20] },
	},
	{
		name: "six_seven",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [6, 7] },
	},
	{
		name: "ninety_nine",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [9, 9] },
	},
	{
		name: "twenty_one",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [2, 1] },
	},
	{
		name: "twenty_three",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [2, 3] },
	},

];
