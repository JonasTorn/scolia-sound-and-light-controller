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

	load(): FullConfig {
		if (this.config) {
			return this.config;
		}

		if (!fs.existsSync(this.configPath)) {
			throw new Error(`Config file not found at ${this.configPath}`);
		}

		try {
			const raw = fs.readFileSync(this.configPath, "utf-8");
			const parsed: FullConfig = JSON.parse(raw);
			TypeValidator.validateFullConfig(parsed);
			this.config = parsed;
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

	getScolia() {
		return this.getConfig().scolia;
	}

	getLightShark() {
		return this.getConfig().lightshark;
	}

	getSound() {
		return this.getConfig().sound;
	}

	getKNX() {
		return this.getConfig().knx;
	}

	getPlaywright() {
		return this.getConfig().playwright;
	}

	getLogging() {
		return this.getConfig().logging;
	}

	getSpecialEvents() {
		return this.getConfig().special_events;
	}

	reload(): FullConfig {
		this.config = null;
		return this.load();
	}
}
