// Scolia API payload types
export interface ScoliaThrowPayload {
	sector: string; // "s14", "d20", "t19", "25", "50", "None", "Bull"
	coordinates: [number, number];
	bounceout: boolean;
}

// Parsed throw data
export interface ParsedThrow {
	points: number;
	multiplier: number; // 1 = single, 2 = double, 3 = triple
	segment: number; // 1-20, 25 (bull), 50 (bullseye)
}

// Game state tracking
export interface GameThrow extends ParsedThrow {
	timestamp: number;
	playedEvents: Record<string, boolean>; // Tracks which special events fired for this throw
	bounceout?: boolean;
	coordinates?: [number, number];
}

export interface GameStateSnapshot {
	throwHistory: GameThrow[];
	lastExecutor: LightSharkExecutor | null;
	specialExecutors: LightSharkExecutor[];
	knxState: "on" | "off";
	strobeActive: boolean;
}

// LightShark executor coordinates
export interface LightSharkExecutor {
	page: number;
	column: number;
	row: number;
	flashMode?: boolean; // true = Flash/Push mode: 1.0 to start, 0.0 to stop (idempotent)
}

// Executor reference — either a name from config.executors or inline coordinates
export type ExecutorRef = string | LightSharkExecutor;

// Unified effect system
export type Effect =
	| { type: "sound"; event: string; files?: string[]; volume?: number; priority?: number; isThrowSound?: boolean }
	| { type: "light"; executor: LightSharkExecutor; mode: "main" | "additive" }
	| { type: "light"; mode: "release" }  // release lastExecutor (e.g. flash-mode dim after a scoring single)
	| { type: "strobe"; executor: LightSharkExecutor; durationMs: number }
	| { type: "knx"; action: string }
	| { type: "overlay"; file: string; durationMs: number };

export interface ThrowEvent {
	name: string;
	effects: Effect[];
}

// Per-player effect overrides on a special event
export interface PlayerOverwrite {
	sound?: SoundEntry;
	overlay?: { file: string; durationMs: number };
	lights?: Array<{ executor: ExecutorRef; mode: "main" | "additive" }>;
}

// Round position constraint — evaluated before the detector runs.
// throwHistory.length + 1 = current throw number in the round (history resets on each takeout).
export interface RoundConstraint {
	throwNumber?: number | number[]; // exact throw(s) to match (1-indexed)
	minThrow?: number;               // fire only if throw number >= minThrow
	maxThrow?: number;               // fire only if throw number <= maxThrow
}

// Special event detection
export interface SpecialEventDefinition {
	name: string;
	enabled: boolean;
	priority?: number; // higher wins when multiple events match the same throw
	detector: string;
	params: Record<string, any>;
	roundConstraint?: RoundConstraint; // optional positional gate, checked before detector
	sound?: SoundEntry; // default sound — auto-falls back to core/{name}.wav if omitted
	overlay?: { file: string; durationMs: number };
	lights?: Array<{ executor: ExecutorRef; mode: "main" | "additive" }>;
	strobe?: { executor: ExecutorRef; durationMs: number }; // timed strobe effect, independent of lights
	players?: string[]; // if set, event only fires when current player is in this list
	playerOverwrites?: Record<string, PlayerOverwrite>; // per-player effect overrides, keyed by player nickname
}

// Config types
export interface ScoliaConfig {
	serialNumber: string;
	accessToken: string;
	serverUrl: string;
	simulationMode: boolean;
	reconnectDelay: number;
}

export interface LightSharkThrowEffect {
	enabled: boolean;
	colorMode: {
		enabled: boolean;
		redExecutor: ExecutorRef;
		greenExecutor: ExecutorRef;
		bullseyeExecutor?: ExecutorRef; // legacy — light now configured in events.config.ts gameEventsConfig.bullseye
		redSegments: number[];
		greenSegments: number[];
		bull25?: "red" | "green";       // legacy — light now configured in events.config.ts gameEventsConfig.bull25
	};
}

export interface LightSharkConfig {
	enabled: boolean;
	ip: string;
	oscPort: number;
	throwEffect: LightSharkThrowEffect;
}

export interface KNXAction {
	ga: string;
	value: number;
	dpt?: string;
}

export interface KNXConfig {
	enabled: boolean;
	gateway: string;
	port: number;
	actions: {
		allOff: KNXAction[];
		allOn: KNXAction[];
	};
}

export interface SoundEntry {
	file?: string; // legacy single-file (backward compat)
	files?: string[]; // multiple files — one is picked at random on each play
	volume?: number;
	enabled?: boolean;
}

export interface SoundConfig {
	enabled: boolean;
	soundsDir: string;
	throwSoundsEnabled?: boolean;   // default true — set false to silence all base throw sounds
	takeoutSoundEnabled?: boolean;  // default true — set false to silence the takeout sound
	sounds?: Record<string, SoundEntry>;
}

export interface OverlayConfig {
	objectFit?: "contain" | "cover" | "fill"; // default: "contain"
	background?: string;                       // default: "rgba(0,0,0,0.65)"
	defaultDurationMs?: number;                // default: 5000 — per-event durationMs overrides this
	width?: string;                            // CSS value, default: "100%"
	height?: string;                           // CSS value, default: "100%"
}

export interface PlaywrightConfig {
	enabled: boolean;
	url: string;
	fullscreen: boolean;
	pollIntervalMs: number;
	cookieFile: string;
	boardName?: string;
	proxyWebSocket?: boolean;
	overlay?: OverlayConfig;
	announcerVolume?: number;      // 0.0–1.0, default 1.0 (full volume)
	muteDuringOurSounds?: boolean; // default true — false = let Scolia and our sounds overlap
	debug?: boolean;               // save DOM snapshots every 10s for debugging
	credentials: {
		email: string;
		password: string;
	};
}

export interface LoggingConfig {
	enabled: boolean;
	consoleOutput: boolean;
	logFile: string;
	maxFileSize: number;
	maxFiles: number;
}

export interface FullConfig {
	scolia: ScoliaConfig;
	lightshark: LightSharkConfig;
	knx: KNXConfig;
	sound: SoundConfig;
	playwright: PlaywrightConfig;
	logging: LoggingConfig;
	players?: Record<string, Record<string, SoundEntry>>; // known players + optional per-player throw-sound overrides
	executors?: Record<string, LightSharkExecutor>;       // named executor map — reference by name in events and colorMode
}

// Logger types
export type LogLevel = "INFO" | "SUCCESS" | "WARN" | "ERROR" | "DEBUG";

// Controller interfaces
export interface ILightSharkController {
	triggerExecutor(executor: LightSharkExecutor): Promise<boolean>; // sends 0.0 (toggle or Flash stop)
	startExecutor(executor: LightSharkExecutor): Promise<boolean>;   // sends 1.0 (Flash go — use for flashMode executors)
}

export interface ISoundController {
	playSound(eventName: string, priority?: number, inlineFiles?: string[], inlineVolume?: number): Promise<void>;
}

export interface IKNXController {
	triggerAction(actionName: string): void;
}

export interface IPlaywrightController {
	showOverlay(file: string, durationMs: number): Promise<void>;
}
