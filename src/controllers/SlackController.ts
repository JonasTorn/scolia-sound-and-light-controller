import { SocketModeClient } from "@slack/socket-mode";
import * as fs from "fs";
import { Logger } from "../utils/Logger";

export interface SlackConfig {
	enabled: boolean;
	slackWebhookUrl?: string;
	label?: string;
	timeoutMs?: number;
	socketMode?: {
		enabled: boolean;
		appToken?: string;
		command?: string;
		debounceMs?: number;
	};
}

function matchesCommand(text: unknown, command: string): boolean {
	if (typeof text !== "string") return false;
	return text.trim().toLowerCase() === command.trim().toLowerCase();
}

// Writes a marker file before process.exit so the next startup can confirm
// "back online" via Slack without spamming on normal pm2/watchdog restarts.
export function markRestart(flagPath: string): void {
	try { fs.writeFileSync(flagPath, String(Date.now())); } catch { /* best-effort */ }
}

export function consumeRestartFlag(flagPath: string): boolean {
	try {
		if (!fs.existsSync(flagPath)) return false;
		fs.unlinkSync(flagPath);
		return true;
	} catch { return false; }
}

export class SlackController {
	private webhookEnabled: boolean;
	private webhookUrl: string;
	private label: string;
	private timeoutMs: number;
	private logger: Logger;

	private listenerEnabled: boolean;
	private appToken: string;
	private command: string;
	private debounceMs: number;
	private lastRestartAt = -Infinity;
	private client: SocketModeClient | null = null;

	private onRestart: () => Promise<void>;

	constructor(
		config: SlackConfig,
		logger: Logger,
		onRestart: () => Promise<void>,
	) {
		this.logger = logger;
		this.onRestart = onRestart;

		this.webhookEnabled = !!(config.enabled && config.slackWebhookUrl);
		this.webhookUrl = config.slackWebhookUrl ?? "";
		this.label = config.label ?? "Scolia";
		this.timeoutMs = config.timeoutMs ?? 5000;

		const sm: NonNullable<SlackConfig["socketMode"]> = config.socketMode ?? { enabled: false };
		this.listenerEnabled = !!(config.enabled && sm.enabled && sm.appToken);
		this.appToken = sm.appToken ?? "";
		this.command = sm.command ?? "!restart";
		this.debounceMs = sm.debounceMs ?? 30000;
	}

	// Fire-and-forget Slack message via incoming webhook.
	async send(message: string): Promise<boolean> {
		return this._post(`*${this.label}*: ${message}`);
	}

	private async _post(text: string): Promise<boolean> {
		if (!this.webhookEnabled) return false;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const res = await fetch(this.webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
				signal: controller.signal,
			});
			if (res && !res.ok) {
				this.logger.warn(`Slack webhook replied ${res.status}`);
				return false;
			}
			return true;
		} catch (err: any) {
			this.logger.warn(`Slack send failed: ${err?.message}`);
			return false;
		} finally {
			clearTimeout(timer);
		}
	}

	private shouldHandle(text: unknown): boolean {
		if (!matchesCommand(text, this.command)) return false;
		const now = Date.now();
		if (now - this.lastRestartAt < this.debounceMs) {
			this.logger.info(`SlackController: '${this.command}' ignored (debounce)`);
			return false;
		}
		this.lastRestartAt = now;
		return true;
	}

	private async _handleMessage(event: any): Promise<void> {
		if (!event || event.bot_id || event.subtype) return;
		if (!this.shouldHandle(event.text)) return;
		this.logger.warn(`SlackController: '${this.command}' received — restarting`);
		try {
			await Promise.race([
				this.send("♻️ Restarting (requested via Slack)…"),
				new Promise<void>((resolve) => setTimeout(resolve, 1500)),
			]);
		} catch { /* never let the ack block the restart */ }
		try {
			await this.onRestart();
		} catch (err: any) {
			this.logger.error(`SlackController: onRestart error: ${err?.message}`);
		}
	}

	async start(): Promise<void> {
		if (!this.listenerEnabled) {
			this.logger.info("SlackController: listener disabled (no appToken / enabled=false)");
			return;
		}
		try {
			this.client = new SocketModeClient({ appToken: this.appToken });
			this.client.on("message", async ({ event, ack }: any) => {
				try { await ack(); } catch { /* must ack within 3s */ }
				await this._handleMessage(event);
			});
			this.client.on("connected", () =>
				this.logger.success("SlackController: Socket Mode connected"),
			);
			this.client.on("disconnected", () =>
				this.logger.warn("SlackController: disconnected (will reconnect automatically)"),
			);
			await this.client.start();
		} catch (err: any) {
			this.logger.error(`SlackController: could not start Socket Mode: ${err?.message}`);
		}
	}

	async stop(): Promise<void> {
		if (this.client) {
			try { await this.client.disconnect(); } catch { /* noop */ }
			this.client = null;
		}
	}
}
