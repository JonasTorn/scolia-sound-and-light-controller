import * as path from "path";
import { execFile, spawn, ChildProcess } from "child_process";
import { Logger } from "../utils/Logger";
import { SoundConfig, SoundEntry } from "../types/index";

export class SoundController {
	private soundsDir: string;
	private psProcess: ChildProcess | null = null;
	private activeProcess: ChildProcess | null = null;
	private closing = false;
	private player: any = null;
	private currentPlayer: string | null = null;
	private currentSoundPriority = 0;

	constructor(
		private config: SoundConfig,
		private logger: Logger,
	) {
		this.soundsDir = path.resolve(
			process.cwd(),
			config.soundsDir || "./sounds",
		);

		if (process.platform === "win32") {
			this.spawnPowerShell();
		} else if (process.platform !== "darwin") {
			// Linux: play-sound (aplay, mpg123, etc.)
			try {
				this.player = require("play-sound")();
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
			{
				windowsHide: true,
				stdio: ["pipe", "ignore", "pipe"],
			},
		);

		this.psProcess.stderr?.on("data", (data) => {
			this.logger.warn(`PowerShell audio error: ${data.toString().trim()}`);
		});

		this.psProcess.on("exit", (code) => {
			this.psProcess = null;
			if (this.closing) return;
			this.logger.warn(
				`PowerShell audio process exited (code ${code}), restarting...`,
			);
			setTimeout(() => this.spawnPowerShell(), 100);
		});

		this.logger.debug("PowerShell audio process started");
	}

	setCurrentPlayer(name: string | null): void {
		this.currentPlayer = name;
	}

	async playSound(eventName: string, priority = 0): Promise<void> {
		if (!this.config.enabled) return;

		if (priority < this.currentSoundPriority) {
			this.logger.debug(`Skipped: ${eventName} (priority ${priority} < active ${this.currentSoundPriority})`);
			return;
		}

		// Per-player override takes priority over global sounds
		if (this.currentPlayer) {
			const playerEntry = this.config.players?.[this.currentPlayer]?.[eventName];
			const playerFiles = this.getFiles(playerEntry);
			if (playerFiles.length > 0 && playerEntry?.enabled !== false) {
				const file = playerFiles[Math.floor(Math.random() * playerFiles.length)];
				const filePath = path.resolve(this.soundsDir, file);
				if (filePath.startsWith(this.soundsDir)) {
					await this.playFile(filePath, playerEntry?.volume ?? 1.0, eventName, priority);
					return;
				}
			}
		}

		const entry = this.config.sounds?.[eventName];
		const files = this.getFiles(entry);

		if (files.length > 0 && entry?.enabled !== false) {
			const file = files[Math.floor(Math.random() * files.length)];
			const filePath = path.resolve(this.soundsDir, file);
			if (!filePath.startsWith(this.soundsDir)) {
				this.logger.warn(`Invalid audio path for: ${eventName}`);
				return;
			}
			await this.playFile(filePath, entry?.volume ?? 1.0, eventName, priority);
			return;
		}

		// Throw-specific name (triple_20, double_5, single_1) → tts/N.wav
		const throwMatch = eventName.match(/^(triple|double|single)_(\d+)$/);
		if (throwMatch) {
			const multMap: Record<string, number> = { triple: 3, double: 2, single: 1 };
			const score = multMap[throwMatch[1]] * parseInt(throwMatch[2]);
			const ttsPath = path.resolve(this.soundsDir, `tts/${score}.wav`);
			if (ttsPath.startsWith(this.soundsDir)) {
				await this.playFile(ttsPath, 1.0, eventName, priority);
			}
			return;
		}

		this.logger.debug(`No audio configured for: ${eventName}`);
	}

	private async playFile(
		filePath: string,
		volume: number,
		eventName: string,
		priority = 0,
	): Promise<void> {
		const fileName = path.basename(filePath);
		this.currentSoundPriority = priority;

		if (process.platform === "win32") {
			if (this.psProcess?.stdin?.writable) {
				this.psProcess.stdin.write(filePath + "\n");
			} else {
				execFile(
					"powershell",
					[
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						"(New-Object Media.SoundPlayer $args[0]).PlaySync()",
						filePath,
					],
					{ windowsHide: true },
					(err) => {
						if (err)
							this.logger.warn(`Audio error "${eventName}": ${err.message}`);
					},
				);
			}
		} else if (process.platform === "darwin") {
			if (this.activeProcess) {
				this.activeProcess.kill();
				this.activeProcess = null;
			}
			const proc = spawn("afplay", ["-v", String(volume), filePath]);
			this.activeProcess = proc;
			proc.on("error", (err) => {
				this.logger.warn(`Audio error "${eventName}": ${err.message}`);
			});
			proc.on("exit", () => {
				if (this.activeProcess === proc) {
					this.activeProcess = null;
					this.currentSoundPriority = 0; // reset when sound finishes naturally
				}
			});
		} else if (this.player) {
			this.player.play(filePath, (err: Error | null) => {
				if (err) this.logger.warn(`Audio error "${eventName}": ${err.message}`);
			});
		}

		this.logger.info(`🔊 Sound: ${eventName} (${fileName})`);
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
