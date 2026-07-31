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

	async playSound(eventName: string): Promise<void> {
		if (!this.config.enabled) return;

		const entry = this.config.sounds?.[eventName];
		const files = this.getFiles(entry);

		let filePath: string;
		const volume = entry?.volume ?? 1.0;

		if (files.length > 0 && entry?.enabled !== false) {
			const file = files[Math.floor(Math.random() * files.length)];
			filePath = path.resolve(this.soundsDir, file);
		} else {
			// Auto-fallback for score events: "score_8" → tts/8.wav
			const scoreMatch = eventName.match(/^score_(\d+)$/);
			if (!scoreMatch) {
				this.logger.debug(`No audio configured for: ${eventName}`);
				return;
			}
			filePath = path.resolve(this.soundsDir, `tts/${scoreMatch[1]}.wav`);
		}

		// Prevent path traversal
		if (!filePath.startsWith(this.soundsDir)) {
			this.logger.warn(`Invalid audio path for: ${eventName}`);
			return;
		}

		await this.playFile(filePath, volume, eventName);
	}

	private async playFile(
		filePath: string,
		volume: number,
		eventName: string,
	): Promise<void> {
		const fileName = path.basename(filePath);

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
				if (this.activeProcess === proc) this.activeProcess = null;
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
