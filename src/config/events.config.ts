import { SpecialEventDefinition, SoundEntry, PlayerOverwrite, ExecutorRef } from "../types/index";

// ============================================================
// GAME EVENTS
// Sounds and overlays for game-level events.
// These are triggered by game state (bust, win, miss, etc.)
// rather than throw patterns.
// ============================================================

export interface GameEventConfig {
	fallback?: string;  // if no sound/overlay set, use this event's config instead
	sound?: SoundEntry;
	lights?: Array<{ executor: ExecutorRef; mode: "main" | "additive" }>;
	strobe?: { executor: ExecutorRef; durationMs: number };
	overlay?: { file: string; durationMs: number };
	playerOverwrites?: Record<string, PlayerOverwrite>;
}

export const gameEventsConfig: Record<string, GameEventConfig> = {
	miss: {
		sound: { files: ["BRUH.wav", "ERROR.wav"] },
		lights: [{ executor: "led_dim_off_hold", mode: "main" }],
	},
	takeout: {
		sound: { files: ["yoshi_tongue.wav"], volume: 0.50 },
	},
	important_round: {
		sound: { files: ["good_bad_ugly.wav"] },
	},
	bust: {
		sound: { files: ["fahhh.wav", "vad_fet_du_ar.wav", "tjockisleif.wav"] },
	},
	leg_won: {
		fallback: "set_won", // no specific leg sound — use set_won effects
		playerOverwrites: {},
	},
	set_won: {
		sound: { files: ["simply_the_best.wav"] },
		overlay: { file: "overlays/winwin.gif", durationMs: 10000 },
		playerOverwrites: {
			"Groggen": { overlay: { file: "overlays/groggen_win.gif", durationMs: 10000 } },
			"Laser": {
				overlay: { file: "overlays/laser_win.gif", durationMs: 10000 },
				sound: { files: ["laser_win.wav"] }
			},
			"T10": { overlay: { file: "overlays/t10_win.gif", durationMs: 10000 } },
			"Sony": { overlay: { file: "overlays/sonny_win.gif", durationMs: 10000 } },

		},
	},
	eliminated: {
		sound: {
			files: [
				"goofy_scream.wav",
				"say_hello_to_my_little_friend.wav",
				"hasta_la_vista_baby.wav",
				"dodge_this.wav",
				"die_mf_die_mf.wav"
			], weights: [2, 1, 1, 1, 1]
		},
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
// Per-player overrides: add a `playerOverwrites` map keyed by the player's nickname
// (as shown in the Scolia web app). That player gets those effects; everyone else
// gets the defaults. Partial — only specified fields replace the base. Example:
//
//   playerOverwrites: {
//     "Laser": { sound: { files: ["laser_180.wav"] }, overlay: { file: "overlays/laser.gif", durationMs: 5000 } },
//   }
//
// Adding a new event:
//   1. Pick a detector (see SpecialEventDetector.ts for available strategies)
//   2. Add an entry below with name, detector, params
//   3. Drop a WAV file at sounds/core/{name}.wav — done.
//   For a brand-new pattern shape, add a detector method in SpecialEventDetector.ts first.
// ============================================================

export const specialEventsConfig: SpecialEventDefinition[] = [
	// ── Bullseye / Bull ───────────────────────────────────────────────────────

	{
		name: "bullseye",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["50"] },
		sound: { files: ["headshot_remix.wav"] },
		lights: [{ executor: "moln_ow_strobe", mode: "main" }],
		strobe: { executor: "led_strobe_rnd_hold", durationMs: 5000 },
	},
	{
		name: "bull25",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["25"] },
		sound: { files: ["headshot.wav"] },
		lights: [{ executor: "led_green", mode: "main" }],
	},

	// ── High priority ────────────────────────────────────────────────────────

	{
		name: "180",
		enabled: true,
		priority: 5,
		detector: "sumLastN",
		params: { n: 3, targetSum: 180 },
		sound: { files: ["monsterkill.wav"] },
		lights: [
			{ executor: "ow_rnd_strobe", mode: "additive" },
			{ executor: "speed_x4", mode: "additive" },
		],
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
		sound: { files: ["007.wav"] },
	},
	{
		name: "123",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s2", "s3"] },
		sound: { files: ["123.wav"] },
	},
	{
		name: "777",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s7", "s7", "s7"] },
		sound: { files: ["jackpot.wav"] },
	},
	{
		name: "s1",
		enabled: true,
		priority: 1,
		detector: "sequentialSegments",
		params: { throws: ["s1"] },
		sound: { files: ["cd1.wav"] },
	},
	{
		name: "t1",
		enabled: true,
		priority: 1,
		detector: "sequentialSegments",
		params: { throws: ["t1"] },
		sound: { files: ["ohh_baby_a_triple.wav"] },
	},
	{
		name: "t6",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t6"] },
		sound: { files: ["666.wav"] },
	},
	{
		name: "666",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s6", "s6", "s6"] },
		sound: { files: ["666.wav"] },
	},
	{
		name: "t7",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t7"] },
		sound: { files: ["jackpot.wav"] },
	},
	{
		name: "t20",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t20"] },
		sound: { files: ["godlike.wav"] },
		strobe: { executor: "led_strobe_rnd_hold", durationMs: 5000 },
	},
	{
		name: "t19",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t19"] },
		sound: { files: ["dominating.wav"] },
	},
	{
		name: "t18",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["t18"] },
		sound: { files: ["unstoppable.wav"] },
	},
	{
		name: "1337",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1337 }, // 13+3+7 or 1+33(T11)+7
		sound: { files: ["machoman_1337.wav"] },
	},
	{
		name: "1904",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1904 }, // 19+0(miss)+4
		sound: { files: ["1904.wav"] },
	},
	{
		name: "1888",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1888 }, // 18+8+8
		sound: { files: ["1888.wav"] },
	},
	{
		// Hassan MC klubben
		name: "1903",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 1903 }, // 19+0+3
		sound: { files: ["mc_klubben.wav"] },
	},
	{
		name: "112",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s2"] },
		sound: { files: ["112.wav"] },
	},
	{
		name: "911",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["s9", "s1", "s1"] },
		sound: { files: ["911.wav"] },
	},
	{
		name: "404",
		enabled: true,
		priority: 2,
		detector: "concatenatesTo",
		params: { number: 404 }, // 4+0(miss)+4
		sound: { files: ["404.wav"] },
	},
	{
		name: "420",
		enabled: true,
		priority: 3,
		detector: "concatenatesTo",
		params: { number: 420 },
		sound: { files: ["smoke_weed_everyday.wav"] },
		overlay: { file: "overlays/420.gif", durationMs: 5000 },
	},
	{
		name: "4+20",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [4, 20] },
		sound: { files: ["smoke_weed_everyday.wav"] },
		overlay: { file: "overlays/420.gif", durationMs: 5000 },
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
		sound: { files: ["rrriktigt_bra.wav"] },
	},

	{
		name: "321",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["s3", "s2", "s1"] },
		sound: { files: ["321.wav"] },
	},
	{
		// 5 - 1 Tony Rickardsson
		name: "51",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s5", "s1"] },
		sound: { files: ["51.wav"] },
	},
	{
		name: "15",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s5"] },
		sound: { files: ["15.wav"] },
	},
	{
		name: "500",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s5", "None", "None"] },
		sound: { files: ["500.wav"] },
	},
	{
		name: "2001",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["s20", "None", "s1"] },
		sound: { files: ["still_dre.wav"] },
	},
	{
		name: "1998",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s19", "s9", "s8"] },
		sound: { files: ["1998.wav"] },
	},
	{
		name: "1994",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s19", "s9", "s4"] },
		sound: { files: ["1994.wav"] },
	},
	{
		// Nile city
		name: "1056",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s10", "s5", "s6"] },
		sound: { files: ["1056.wav"] },
	},
	{
		// Morsan i linköping
		name: "013",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["None", "s1", "s3"] },
		sound: { files: ["britt-marie.wav"] },
	},
	{
		name: "last_chance",
		enabled: true,
		priority: 2,
		detector: "consecutiveMisses",
		params: { count: 2 },
		roundConstraint: { maxThrow: 2 },
		sound: { files: ["last_chance.wav"] },
	},

	// ── Minor fun events ─────────────────────────────────────────────────────

	{
		name: "111",
		enabled: true,
		priority: 3,
		detector: "sequentialSegments",
		params: { throws: ["s1", "s1", "s1"] },
		sound: { files: ["111.wav"] },
	},
	{
		name: "300",
		enabled: true,
		priority: 2,
		detector: "sequentialSegments",
		params: { throws: ["s3", "None", "None"] },
		sound: { files: ["this_is_sparta.wav"] },
		overlay: { file: "overlays/300_kick.gif", durationMs: 5000 },
	},
	{
		name: "99",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [9, 9] },
		sound: { files: ["gretzky.wav"] },
	},
	{
		name: "sum=99",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "99" },
		sound: { files: ["gretzky.wav"] },
	},
	{
		name: "69",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [6, 9] }, // any 6-pt throw → any 9-pt throw
		sound: { files: ["gunther.wav"] },
		overlay: { file: "overlays/gunther.gif", durationMs: 5000 },
	},
	{
		name: "sum=69",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "69" },
		sound: { files: ["gunther.wav"] },
		overlay: { file: "overlays/gunther.gif", durationMs: 5000 },
	},
	{
		name: "67",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [6, 7] },
		sound: { files: ["67.wav"] },
		overlay: { file: "overlays/6-7.gif", durationMs: 5000 },
	},
	{
		name: "sum=67",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "67" },
		sound: { files: ["67.wav"] },
		overlay: { file: "overlays/6-7.gif", durationMs: 5000 },
	},
	{
		// Foppa
		name: "sum=21",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "21" },
		sound: { files: ["foppa_modorov.wav", "foppa_borje.wav"] },
	},
	{
		// Jordan
		name: "sum=23",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "23" },
		sound: { files: ["jordan.wav"] },
	},
	{
		// Idol - 32-33
		name: "33",
		enabled: true,
		priority: 2,
		detector: "consecutivePattern",
		params: { pattern: [3, 3] },
		sound: { files: ["32_33.wav"] },
	},
	{
		name: "sum=33",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "33" },
		sound: { files: ["32_33.wav"] },
	},
	// ── Over / Under ────────────────────────────────────────────────────────
	{
		name: "over_100",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: ">=100" },
		sound: { files: ["rrriktigt_bra.wav"] },
	},
	{
		name: "under_10",
		enabled: true,
		priority: 2,
		detector: "sumLastN",
		params: { n: 3, targetSum: "<10" },
		sound: { files: ["skogsturken_edit.wav"] },
	},

	// ── Multiplier ───────────────────────────────────────────────────────
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
