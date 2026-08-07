import { SpecialEventDefinition, SoundEntry } from "../types/index";

// ============================================================
// GAME EVENTS
// Sounds and overlays for game-level events.
// These are triggered by game state (bust, win, miss, etc.)
// rather than throw patterns.
// ============================================================

export interface GameEventConfig {
	sound?: SoundEntry;
	lights?: Array<{ executor: { page: number; column: number; row: number }; mode: "main" | "additive" }>;
	overlay?: { file: string; durationMs: number };
}

export const gameEventsConfig: Record<string, GameEventConfig> = {
	miss: {
		sound: { files: ["BRUH.mp3", "ERROR.mp3"] },
	},
	bull25: {
		sound: { files: ["headshot.wav"] },
	},
	bullseye: {
		sound: { files: ["headshot.wav"] },
	},
	
	takeout: {
		sound: { files: ["yoshi_tongue.mp3"], volume: 0.70 },
	},
	bust: {
		sound: { files: ["fahhh.mp3", "vad_fet_du_ar.mp3", "tjockisleif.mp3"] },
	},
	leg_won: {
		sound: { files: ["winner.wav"] },
		// overlay: { file: "overlays/leg_won.gif", durationMs: 5000 },
	},
	set_won: {
		sound: { files: ["simply_the_best.mp3"] },
		overlay: { file: "overlays/winwin.gif", durationMs: 10000 },
	},
	eliminated: {
		sound: { files: ["wilhelm_scream.mp3"] },
	},
};

// ============================================================
// SPECIAL EVENTS
// Throw-pattern based events detected from throw history.
//
// Priority scale:
//   1 = minor fun events (two-dart combos like 21, 67, 99)
//   2 = notable combos (three-dart sequences, 007, 404, etc.)
//   3 = high-score moments (180, 120, sum-69)
//   5 = game events (bust, leg won, set won) — set in EventOrchestrator
//
// When two events match the same throw, the highest priority wins.
//
// Sound: omit the `sound` field to auto-resolve from sounds/core/{name}.wav.
//
// Per-player sounds: add a `playerSounds` map keyed by the player's nickname
// (as shown in the Scolia web app). That player gets their own sound; everyone
// else gets the default. Example:
//
//   playerSounds: {
//     "Laser": { files: ["core/laser_180.wav"] },
//   }
//
// Adding a new event:
//   1. Pick a detector (see SpecialEventDetector.ts for available strategies)
//   2. Add an entry below with name, detector, params
//   3. Drop a WAV file at sounds/core/{name}.wav — done.
//   For a brand-new pattern shape, add a detector method in SpecialEventDetector.ts first.
// ============================================================

export const specialEventsConfig: SpecialEventDefinition[] = [
	// ── High priority ────────────────────────────────────────────────────────

	{
		name: "180",
		enabled: true,
		priority: 3,
		detector: "sumLastN",
		params: { n: 3, targetSum: 180 },
		sound: { files: ["monsterkill.wav"] },
		lights: [
			{ executor: { page: 1, column: 6, row: 2 }, mode: "additive" },
			{ executor: { page: 1, column: 7, row: 2 }, mode: "additive" },
		],
	},
	{
		name: "69",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 69 },
		sound: { files: ["gunther.mp3"] },
		overlay: { file: "overlays/gunther.gif", durationMs: 5000 },
	},

	{
		name: "2xt20",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["t20", "t20"] },
		sound: { files: ["monsterkill.wav"] },
	},

	// ── Notable combos ────────────────────────────────────────────────────────

	{
		name: "007",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["None", "None", "s7"] },
		sound: { files: ["007.mp3"] },
	},
	{
		name: "123",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s2", "s3"] },
	},
	{
		name: "777",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s7", "s7", "s7"] },
		sound: { files: ["jackpot.mp3"] },
	},
	{
		name: "s1",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1"] },
		sound: { files: ["cd1.wav"] },
	},
	{
		name: "t1",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t1"] },
		sound: { files: ["ohh_baby_a_triple.mp3"] },
	},
	{
		name: "t7",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t7"] },
		sound: { files: ["jackpot.mp3"] },
	},
	{
		name: "t20",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t20"] },
		sound: { files: ["godlike.wav"] },
	},
	{
		name: "1337",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1337 }, // 13+3+7 or 1+33(T11)+7
		sound: { files: ["machoman_1337.mp3"] },
	},
	{
		name: "1904",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1904 }, // 19+0(miss)+4
	},
	{
		name: "1888",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1888 }, // 18+8+8
	},
	{
		name: "112",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s2"] },
	},
	{
		name: "911",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s9", "s1", "s1"] },
	},
	{
		name: "666",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s6", "s6", "s6"] },
	},
	{
		name: "404",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 404 }, // 4+0(miss)+4
	},
	{
		name: "420", // smoke weed every day!
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 420 },
		sound: { files: ["smoke_weed_everyday.mp3"] },
	},
	{
		name: "000",
		enabled: true,
		priority: 2,
		detector: "consecutiveMisses",
		params: { count: 3 },
		sound: { files: ["all-hail-king-of-the-losers.wav"] },
	},
	{
		name: "20x3",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s20", "s20", "s20"] },
		sound: { files: ["rrriktigt_bra.mp3"] },
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
		name: "69",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [6, 9] }, // any 6-pt throw → any 9-pt throw
		sound: { files: ["core/sixty_nine.wav"] },
	},
	{
		name: "111",
		enabled: true,
		priority: 1,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s1"] },
	},
	{
		name: "420",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [4, 20] },
	},
	{
		name: "67",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [6, 7] },
	},
	{
		name: "99",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [9, 9] },
	},
	{
		name: "21",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [2, 1] },
	},
	{
		name: "33",
		enabled: true,
		priority: 1,
		detector: "consecutivePattern",
		params: { pattern: [3, 3] },
		sound: { files: ["32_33.mp3"] },
	},
	{
		name: "good_visit",
		enabled: true,
		priority: 1,
		detector: "sumLastN",
		params: { n: 3, targetSum: ">=100" },
		sound: { files: ["rrriktigt_bra.mp3"] },
	},
	{
		name: "poor_visit",
		enabled: true,
		priority: 1,
		detector: "sumLastN",
		params: { n: 3, targetSum: "<10" },
		sound: { files: ["BRUH.mp3"] },
	},
	{
		name: "any_double",
		enabled: true,
		priority: 1,
		detector: "multiplierIs",
		params: { multiplier: 2 },
		sound: { files: ["doublekill.wav"] },
	},
	{
		name: "any_triple",
		enabled: true,
		priority: 1,
		detector: "multiplierIs",
		params: { multiplier: 3 },
		sound: { files: ["triplekill.wav"] },
	},
];
