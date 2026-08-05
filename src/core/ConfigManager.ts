import * as fs from "fs";
import * as path from "path";
import { FullConfig } from "../types/index";
import { TypeValidator } from "../utils/TypeValidator";

export class ConfigManager {
	private config: FullConfig | null = null;
	private configPath: string;

	constructor(configPath?: string) {
		this.configPath = configPath || path.resolve(process.cwd(), "config.json");
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

		try {
			const raw = fs.readFileSync(this.configPath, "utf-8");
			let parsed = JSON.parse(raw);

			const secretsPath = path.join(path.dirname(this.configPath), "config.secrets.json");
			if (fs.existsSync(secretsPath)) {
				const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
				parsed = this.deepMerge(parsed, secrets);
			}

			TypeValidator.validateFullConfig(parsed);
			this.config = parsed as FullConfig;
			return this.config;
		} catch (err) {
			if (err instanceof Error) {
				throw new Error(`Failed to load config: ${err.message}`);
			}
			throw err;
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
