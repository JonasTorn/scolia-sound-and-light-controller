import * as fs from "fs";
import * as path from "path";
import { FullConfig } from "../types/index";
import { TypeValidator } from "../utils/TypeValidator";

export class ConfigManager {
	private config: FullConfig | null = null;
	private configPath: string;

	constructor(configPath?: string) {
		// __dirname is src/core/ (ts-node) or dist/core/ (compiled).
		// config.json lives two levels up at the project root in both cases.
		this.configPath = configPath || path.resolve(__dirname, "..", "..", "config.json");
	}

	private deepMerge(base: any, override: any): any {
		const result = { ...base };
		for (const key of Object.keys(override)) {
			const val = override[key];
			if (val !== null && typeof val === "object" && !Array.isArray(val)) {
				result[key] = this.deepMerge(base[key] ?? {}, val);
			} else {
				result[key] = val;
			}
		}
		return result;
	}

	load(): FullConfig {
		if (this.config) {
			return this.config;
		}

		if (!fs.existsSync(this.configPath)) {
			throw new Error(`Config file not found at ${this.configPath}`);
		}

		let activeFile = this.configPath;
		try {
			const raw = fs.readFileSync(this.configPath, "utf-8");
			let parsed = JSON.parse(raw);

			const secretsPath = path.join(path.dirname(this.configPath), "config.secrets.json");
			if (fs.existsSync(secretsPath)) {
				activeFile = secretsPath;
				const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
				parsed = this.deepMerge(parsed, secrets);
			}

			TypeValidator.validateFullConfig(parsed);
			this.config = parsed as FullConfig;
			return this.config;
		} catch (err) {
			// Emit detailed diagnostics so the next failure is easy to diagnose.
			const msg = err instanceof Error ? err.message : String(err);
			try {
				const raw = fs.readFileSync(activeFile, "utf-8");
				// Extract ~200 chars around the error position if it's a parse error
				const posMatch = msg.match(/position (\d+)/);
				if (posMatch) {
					const pos = parseInt(posMatch[1], 10);
					const snippet = raw.slice(Math.max(0, pos - 80), pos + 80).replace(/\r/g, "");
					console.error(`[ConfigManager] Parse failed in: ${activeFile}`);
					console.error(`[ConfigManager] File size: ${raw.length} bytes, cwd: ${process.cwd()}`);
					console.error(`[ConfigManager] Content around position ${pos}:\n---\n${snippet}\n---`);
				} else {
					console.error(`[ConfigManager] Error in: ${activeFile} (cwd: ${process.cwd()})`);
				}
			} catch {
				console.error(`[ConfigManager] Could not read ${activeFile} for diagnostics`);
			}
			throw new Error(`Failed to load config: ${msg}`);
		}
	}

	getConfig(): FullConfig {
		if (!this.config) {
			return this.load();
		}
		return this.config;
	}

	reload(): FullConfig {
		this.config = null;
		return this.load();
	}
}
