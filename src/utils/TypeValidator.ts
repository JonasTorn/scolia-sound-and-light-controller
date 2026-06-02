import { FullConfig } from "../types/index";

export class TypeValidator {
	static validateFullConfig(config: any): config is FullConfig {
		if (!config || typeof config !== "object") {
			throw new Error("Config must be an object");
		}

		// Validate scolia section
		if (!config.scolia || typeof config.scolia !== "object") {
			throw new Error("Config must have a valid scolia section");
		}
		if (typeof config.scolia.accessToken !== "string") {
			throw new Error("scolia.accessToken must be a string");
		}

		// Validate lightshark section
		if (config.lightshark && typeof config.lightshark === "object") {
			if (
				config.lightshark.enabled &&
				typeof config.lightshark.ip !== "string"
			) {
				throw new Error("lightshark.ip must be a string when enabled");
			}
			if (
				config.lightshark.oscPort &&
				typeof config.lightshark.oscPort !== "number"
			) {
				throw new Error("lightshark.oscPort must be a number");
			}
		}

		// Validate knx section
		if (config.knx && typeof config.knx === "object") {
			if (config.knx.enabled && typeof config.knx.gateway !== "string") {
				throw new Error("knx.gateway must be a string when enabled");
			}
		}

		// Validate sound section
		if (config.sound && typeof config.sound === "object") {
			if (config.sound.enabled && typeof config.sound.soundsDir !== "string") {
				throw new Error("sound.soundsDir must be a string when enabled");
			}
		}

		// Validate playwright section
		if (config.playwright && typeof config.playwright === "object") {
			if (config.playwright.enabled) {
				if (typeof config.playwright.url !== "string") {
					throw new Error("playwright.url must be a string when enabled");
				}
				if (
					!config.playwright.credentials ||
					typeof config.playwright.credentials !== "object"
				) {
					throw new Error(
						"playwright.credentials must be an object when enabled",
					);
				}
			}
		}

		return true;
	}

	static validateExecutor(executor: any): boolean {
		return (
			executor &&
			typeof executor === "object" &&
			typeof executor.page === "number" &&
			typeof executor.column === "number" &&
			typeof executor.row === "number"
		);
	}

	static validateThrowPayload(payload: any): boolean {
		return (
			payload &&
			typeof payload === "object" &&
			typeof payload.sector === "string" &&
			Array.isArray(payload.coordinates) &&
			payload.coordinates.length === 2 &&
			typeof payload.bounceout === "boolean"
		);
	}
}
