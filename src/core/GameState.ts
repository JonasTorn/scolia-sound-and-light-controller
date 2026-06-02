import * as fs from "fs";
import * as path from "path";
import {
	GameThrow,
	GameStateSnapshot,
	LightSharkExecutor,
} from "../types/index";

export class GameState {
	private throwHistory: GameThrow[] = [];
	private lastExecutor: LightSharkExecutor | null = null;
	private specialExecutors: LightSharkExecutor[] = [];
	private knxState: "on" | "off" = "on";
	private strobeActive = false;
	private persistencePath: string;
	private readonly MAX_HISTORY = 100;

	constructor(persistencePath?: string) {
		this.persistencePath =
			persistencePath || path.resolve(process.cwd(), "throw-history.json");
		this.loadFromDisk();
	}

	// Throw history management
	addThrow(throwData: Omit<GameThrow, "playedEvents">): GameThrow {
		const gameThrow: GameThrow = {
			...throwData,
			playedEvents: {},
		};

		this.throwHistory.push(gameThrow);

		// Keep history bounded
		if (this.throwHistory.length > this.MAX_HISTORY) {
			this.throwHistory = this.throwHistory.slice(-this.MAX_HISTORY);
		}

		this.saveToDisk();
		return gameThrow;
	}

	getThrowHistory(limit?: number): GameThrow[] {
		if (limit === undefined) {
			return [...this.throwHistory];
		}
		return this.throwHistory.slice(-limit);
	}

	getLastThrow(): GameThrow | null {
		return this.throwHistory.length > 0
			? this.throwHistory[this.throwHistory.length - 1]
			: null;
	}

	getLastNThrows(n: number): GameThrow[] {
		return this.throwHistory.slice(-n);
	}

	// Executor tracking
	setLastExecutor(executor: LightSharkExecutor | null): void {
		this.lastExecutor = executor;
		this.saveToDisk();
	}

	getLastExecutor(): LightSharkExecutor | null {
		return this.lastExecutor;
	}

	// Special executors (for multi-executor effects like 180)
	setSpecialExecutors(executors: LightSharkExecutor[]): void {
		this.specialExecutors = [...executors];
		this.saveToDisk();
	}

	getSpecialExecutors(): LightSharkExecutor[] {
		return [...this.specialExecutors];
	}

	addSpecialExecutor(executor: LightSharkExecutor): void {
		if (!this.specialExecutors.some((e) => this.executorEquals(e, executor))) {
			this.specialExecutors.push(executor);
			this.saveToDisk();
		}
	}

	clearSpecialExecutors(): void {
		this.specialExecutors = [];
		this.saveToDisk();
	}

	// KNX state tracking
	setKNXState(state: "on" | "off"): void {
		if (this.knxState !== state) {
			this.knxState = state;
			this.saveToDisk();
		}
	}

	getKNXState(): "on" | "off" {
		return this.knxState;
	}

	// Strobe state
	setStrobeActive(active: boolean): void {
		if (this.strobeActive !== active) {
			this.strobeActive = active;
			this.saveToDisk();
		}
	}

	isStrobeActive(): boolean {
		return this.strobeActive;
	}

	// Special event tracking (prevent duplicates)
	markEventPlayed(throwIndex: number, eventName: string): void {
		if (throwIndex >= 0 && throwIndex < this.throwHistory.length) {
			this.throwHistory[throwIndex].playedEvents[eventName] = true;
			this.saveToDisk();
		}
	}

	isEventPlayed(throwIndex: number, eventName: string): boolean {
		if (throwIndex >= 0 && throwIndex < this.throwHistory.length) {
			return !!this.throwHistory[throwIndex].playedEvents[eventName];
		}
		return false;
	}

	// State reset
	reset(): void {
		this.throwHistory = [];
		this.lastExecutor = null;
		this.specialExecutors = [];
		this.knxState = "on";
		this.strobeActive = false;
		this.saveToDisk();
	}

	// Serialization
	serialize(): GameStateSnapshot {
		return {
			throwHistory: [...this.throwHistory],
			lastExecutor: this.lastExecutor,
			specialExecutors: [...this.specialExecutors],
			knxState: this.knxState,
			strobeActive: this.strobeActive,
		};
	}

	// Persistence
	private saveToDisk(): void {
		try {
			const snapshot = this.serialize();
			fs.writeFileSync(
				this.persistencePath,
				JSON.stringify(snapshot, null, 2),
				"utf-8",
			);
		} catch (err) {
			// Silently fail on persistence errors to not disrupt runtime
			console.error(
				`Failed to save game state to ${this.persistencePath}:`,
				err,
			);
		}
	}

	private loadFromDisk(): void {
		try {
			if (!fs.existsSync(this.persistencePath)) {
				return;
			}
			const raw = fs.readFileSync(this.persistencePath, "utf-8");
			const snapshot: GameStateSnapshot = JSON.parse(raw);

			this.throwHistory = snapshot.throwHistory || [];
			this.lastExecutor = snapshot.lastExecutor || null;
			this.specialExecutors = snapshot.specialExecutors || [];
			this.knxState = snapshot.knxState || "on";
			this.strobeActive = snapshot.strobeActive || false;
		} catch (err) {
			console.error(
				`Failed to load game state from ${this.persistencePath}:`,
				err,
			);
			// Continue with default empty state
		}
	}

	private executorEquals(
		a: LightSharkExecutor,
		b: LightSharkExecutor,
	): boolean {
		return a.page === b.page && a.column === b.column && a.row === b.row;
	}
}
