import * as fs from "fs";
import * as path from "path";
import { execFile, spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { Logger } from "../utils/Logger";
import { FullConfig, SoundConfig, SoundEntry } from "../types/index";
import { gameEventsConfig } from "../config/events.config";

export class SoundController extends EventEmitter {
	private soundsDir: string;
	private psProcess: ChildProcess | null = null;
	private activeProcess: ChildProcess | null = null;
	private closing = false;
	private linuxPlayer: any = null; // play-sound has no type definitions
	private currentPlayer: string | null = null;
	private currentSoundPriority = 0;

	constructor(
		private config: FullConfig,
		private logger: Logger,
	) {
		super();
		this.soundsDir = path.resolve(process.cwd(), config.sound.soundsDir || "./sounds");

		if (process.platform === "win32") {
			this.spawnPowerShell();
		} else if (process.platform !== "darwin") {
			try {
				this.linuxPlayer = require("play-sound")();
			} catch {
				this.logger.warn("play-sound not available on Linux");
			}
		}
	}

	private spawnPowerShell(): void {
		const script = [
			"[Console]::InputEncoding = [System.Text.Encoding]::UTF8",
			"while ($true) {",
			"  $line = [Console]::ReadLine()",
			"  if ($line -eq $null) { break }",
			"  try {",
			"    (New-Object System.Media.SoundPlayer $line).Play()",
			"  } catch {",
			"    [Console]::Error.WriteLine($_.Exception.Message)",
			"  }",
			"}",
		].join("\n");

		this.psProcess = spawn(
			"powershell",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
		);

		this.psProcess.stderr?.on("data", (data) => {
			this.logger.warn(`PowerShell audio error: ${data.toString().trim()}`);
		});

		this.psProcess.on("exit", (code) => {
			this.psProcess = null;
			if (this.closing) return;
			this.logger.warn(`PowerShell audio process exited (code ${code}), restarting...`);
			setTimeout(() => this.spawnPowerShell(), 100);
		});

		this.logger.debug("PowerShell audio process started");
	}

	setCurrentPlayer(name: string | null): void {
		this.currentPlayer = name;
	}

	async playSound(
		eventName: string,
		priority = 0,
		inlineFiles?: string[],
		inlineVolume?: number,
	): Promise<void> {
		if (!this.config.sound.enabled) return;

		if (priority < this.currentSoundPriority) {
			this.logger.debug(`Skipped: ${eventName} (priority ${priority} < active ${this.currentSoundPriority})`);
			return;
		}

		// 1. Config-level per-player override (from config.json → players, for throw sounds)
		if (this.currentPlayer) {
			const entry = this.config.players?.[this.currentPlayer]?.[eventName];
			if (entry && entry.enabled !== false && await this.tryPlayEntry(entry, eventName, priority)) return;
		}

		// 2. Inline files from event definition (or playerOverwrites-resolved files)
		// Empty array [] = explicitly silent — skip all fallbacks.
		if (inlineFiles !== undefined) {
			if (inlineFiles.length) await this.tryPlayFiles(inlineFiles, inlineVolume ?? 1.0, eventName, priority);
			return;
		}

		// 3. Game events config (events.config.ts)
		const gameEntry = gameEventsConfig[eventName]?.sound;
		if (gameEntry && gameEntry.enabled !== false && await this.tryPlayEntry(gameEntry, eventName, priority)) return;

		// 4. Core sounds for throw names (triple_20 → core/60.wav, double_5 → core/10.wav, etc.)
		// Singles intentionally excluded — no auto-resolve to core number TTS files.
		const throwMatch = eventName.match(/^(triple|double)_(\d+)$/);
		if (throwMatch) {
			const multipliers: Record<string, number> = { triple: 3, double: 2, single: 1 };
			const score = multipliers[throwMatch[1]] * parseInt(throwMatch[2]);
			await this.tryPlayFiles([`core/${score}.wav`], 1.0, eventName, priority);
			return;
		}

		// 5. Core sound fallback — core/{eventName}.wav if it exists
		if (!await this.tryPlayFiles([`core/${eventName}.wav`], 1.0, eventName, priority, true)) {
			this.logger.debug(`No audio configured for: ${eventName}`);
		}
	}

	private async tryPlayEntry(entry: SoundEntry, eventName: string, priority: number): Promise<boolean> {
		return this.tryPlayFiles(this.getFiles(entry), entry.volume ?? 1.0, eventName, priority, false, entry.weights);
	}

	private pickWeighted(files: string[], weights?: number[]): string {
		if (!weights || weights.length !== files.length) {
			return files[Math.floor(Math.random() * files.length)];
		}
		const total = weights.reduce((s, w) => s + w, 0);
		let r = Math.random() * total;
		for (let i = 0; i < files.length; i++) {
			r -= weights[i];
			if (r <= 0) return files[i];
		}
		return files[files.length - 1];
	}

	private async tryPlayFiles(
		files: string[],
		volume: number,
		eventName: string,
		priority: number,
		requireExist = false,
		weights?: number[],
	): Promise<boolean> {
		if (!files.length) return false;
		const file = this.pickWeighted(files, weights);
		const filePath = path.resolve(this.soundsDir, file);
		if (!filePath.startsWith(this.soundsDir)) return false;
		if (requireExist && !fs.existsSync(filePath)) return false;
		await this.playFile(filePath, volume, eventName, priority);
		return true;
	}

	private getWavDurationMs(filePath: string): number {
		try {
			const buf = fs.readFileSync(filePath);
			if (buf.length < 44) return 8000;
			const byteRate = buf.readUInt32LE(28);
			const dataSize = buf.readUInt32LE(40);
			if (byteRate === 0) return 8000;
			return Math.ceil((dataSize / byteRate) * 1000) + 300;
		} catch {
			return 8000;
		}
	}

	private async playFile(
		filePath: string,
		volume: number,
		eventName: string,
		priority = 0,
	): Promise<void> {
		this.currentSoundPriority = priority;
		this.emit("playing");

		if (process.platform === "win32") {
			const durationMs = this.getWavDurationMs(filePath);
			if (this.psProcess?.stdin?.writable) {
				this.psProcess.stdin.write(filePath + "\n");
			} else {
				execFile(
					"powershell",
					["-NoProfile", "-NonInteractive", "-Command",
						"(New-Object Media.SoundPlayer $args[0]).PlaySync()", filePath],
					{ windowsHide: true },
					(err) => { if (err) this.logger.warn(`Audio error "${eventName}": ${err.message}`); },
				);
			}
			setTimeout(() => {
				this.currentSoundPriority = 0;
				this.emit("stopped");
			}, durationMs);
		} else if (process.platform === "darwin") {
			if (this.activeProcess) {
				this.activeProcess.kill();
				this.activeProcess = null;
			}
			const proc = spawn("afplay", ["-v", String(volume), filePath]);
			this.activeProcess = proc;
			// Brief grace period before resetting priority — prevents concurrent events
			// (arriving within ms of each other) from overriding high-priority sounds like
			// "eliminated". After the window, throws can still interrupt long sounds (set_won etc).
			setTimeout(() => { this.currentSoundPriority = 0; }, 500);
			proc.on("error", (err) => { this.logger.warn(`Audio error "${eventName}": ${err.message}`); });
			proc.on("exit", () => {
				if (this.activeProcess === proc) {
					this.activeProcess = null;
					this.currentSoundPriority = 0;
				}
				this.emit("stopped");
			});
		} else if (this.linuxPlayer) {
			this.linuxPlayer.play(filePath, (err: Error | null) => {
				if (err) this.logger.warn(`Audio error "${eventName}": ${err.message}`);
				this.emit("stopped");
			});
		}

		this.logger.info(`🔊 Sound: ${eventName} (${path.basename(filePath)})`);
	}

	private getFiles(entry: SoundEntry | undefined): string[] {
		if (!entry) return [];
		if (entry.files?.length) return entry.files;
		if (entry.file) return [entry.file];
		return [];
	}

	close(): void {
		this.closing = true;
		if (this.activeProcess) {
			this.activeProcess.kill();
			this.activeProcess = null;
		}
		if (this.psProcess) {
			this.psProcess.stdin?.end();
			this.psProcess.kill();
			this.psProcess = null;
		}
	}
}
