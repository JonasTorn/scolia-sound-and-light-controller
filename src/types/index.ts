// Scolia API payload types
export interface ScoliaThrowPayload {
	sector: string; // "s14", "d20", "t19", "25", "50", "None", "Bull"
	coordinates: [number, number];
	bounceout: boolean;
}

export interface ScoliaTakeoutPayload {
	// Takeout event payload (minimal)
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
}

// Effect resolution output
export interface EffectResolution {
	executor: LightSharkExecutor | null;
	effectName: string;
	hasStrobe: boolean;
	strobeExecutor: LightSharkExecutor | null;
	strobeDurationMs: number;
}

// Special event detection
export interface SpecialEventDefinition {
	name: string;
	enabled: boolean;
	detector: string; // Strategy name: 'sumLastN', 'consecutiveTriples', 'sequentialSegments', etc.
	params: Record<string, any>;
	sound: string | null;
	effects: SpecialEventEffect[];
}

export interface SpecialEventEffect {
	type: "lightshark" | "knx" | "sound";
	executor?: LightSharkExecutor;
	action?: string;
	sound?: string;
}

export interface SpecialEventMatch {
	eventName: string;
	sound: string | null;
	effects: SpecialEventEffect[];
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
		redExecutor: LightSharkExecutor;
		greenExecutor: LightSharkExecutor;
		bullseyeExecutor: LightSharkExecutor;
		redSegments: number[];
		greenSegments: number[];
		bull25: "red" | "green";
		triple20Strobe: {
			executor: LightSharkExecutor;
			durationMs: number;
		};
	};
	noScoreExecutor: LightSharkExecutor;
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

export interface SoundConfig {
	enabled: boolean;
	soundsDir: string;
	sounds: Record<string, { file: string; volume?: number; enabled?: boolean }>;
}

export interface PlaywrightConfig {
	enabled: boolean;
	url: string;
	fullscreen: boolean;
	pollIntervalMs: number;
	cookieFile: string;
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
	special_events: Record<string, { enabled: boolean }>;
}

// Logger types
export type LogLevel = "INFO" | "SUCCESS" | "WARN" | "ERROR" | "DEBUG";

// Controller interfaces
export interface ILightSharkController {
	triggerExecutor(executor: LightSharkExecutor): Promise<void>;
}

export interface ISoundController {
	playSound(eventName: string): Promise<void>;
}

export interface IKNXController {
	triggerAction(actionName: string): Promise<void>;
}

export interface IPlaywrightController {
	start(): Promise<void>;
	stop(): Promise<void>;
}
