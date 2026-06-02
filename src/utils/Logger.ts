import * as fs from "fs";
import * as path from "path";
import { LogLevel } from "../types/index";

export interface LoggerConfig {
	enabled?: boolean;
	consoleOutput?: boolean;
	logFile?: string;
	maxFileSize?: number;
	maxFiles?: number;
}

export class Logger {
	private config: LoggerConfig;
	private logFile: string;
	private maxFileSize: number;
	private maxFiles: number;
	private stream: fs.WriteStream | null = null;

	constructor(config?: LoggerConfig) {
		this.config = config || { enabled: true, consoleOutput: true };
		this.logFile = path.resolve(
			process.cwd(),
			this.config.logFile || "dart-events.log",
		);
		this.maxFileSize = this.config.maxFileSize || 5 * 1024 * 1024; // 5 MB
		this.maxFiles = this.config.maxFiles || 3;

		if (this.config.enabled && this.logFile) {
			this.rotateIfNeeded();
			this.stream = fs.createWriteStream(this.logFile, { flags: "a" });
		}
	}

	private rotateIfNeeded(): void {
		try {
			const stats = fs.statSync(this.logFile);
			if (stats.size < this.maxFileSize) return;
		} catch {
			return; // File doesn't exist yet
		}

		const ext = path.extname(this.logFile);
		const base = this.logFile.slice(0, -ext.length || undefined);

		// Delete oldest, shift others: .3 → delete, .2 → .3, .1 → .2
		for (let i = this.maxFiles - 1; i >= 1; i--) {
			const older = `${base}.${i + 1}${ext}`;
			const newer = `${base}.${i}${ext}`;
			try {
				fs.unlinkSync(older);
			} catch {
				/* file may not exist */
			}
			try {
				fs.renameSync(newer, older);
			} catch {
				/* file may not exist */
			}
		}

		try {
			fs.renameSync(this.logFile, `${base}.1${ext}`);
		} catch {
			/* file may not exist */
		}
	}

	private log(level: LogLevel, ...args: any[]): void {
		const timestamp = new Date().toISOString();
		const message = args.join(" ");

		if (this.config.consoleOutput) {
			const prefix = this.getPrefix(level);
			console.log(`${prefix} ${message}`);
		}

		if (this.stream) {
			this.stream.write(`[${timestamp}] [${level}] ${message}\n`);
		}
	}

	private getPrefix(level: LogLevel): string {
		const now = new Date();
		const time = now.toLocaleTimeString("sv-SE");

		switch (level) {
			case "INFO":
				return `[${time}] ℹ️`;
			case "SUCCESS":
				return `[${time}] ✓`;
			case "WARN":
				return `[${time}] ⚠️`;
			case "ERROR":
				return `[${time}] ❌`;
			case "DEBUG":
				return `[${time}] 🔍`;
			default:
				return `[${time}]`;
		}
	}

	info(...args: any[]): void {
		this.log("INFO", ...args);
	}

	success(...args: any[]): void {
		this.log("SUCCESS", ...args);
	}

	warn(...args: any[]): void {
		this.log("WARN", ...args);
	}

	error(...args: any[]): void {
		this.log("ERROR", ...args);
	}

	debug(...args: any[]): void {
		if (process.env.DEBUG) {
			this.log("DEBUG", ...args);
		}
	}

	close(): void {
		if (this.stream) {
			this.stream.destroy();
			this.stream = null;
		}
	}
}
