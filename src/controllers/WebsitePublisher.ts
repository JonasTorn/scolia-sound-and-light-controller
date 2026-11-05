import { Logger } from "../utils/Logger";
import { PlayerStats, WebsitePublishConfig } from "../types/index";

// Pushes scoreboard stats to the public website (WordPress REST endpoint).
// Outbound only, never awaited by callers, never throws — a down or slow site
// must not affect game handling.
export class WebsitePublisher {
	private enabled: boolean;
	private url: string;
	private token: string;
	private timeoutMs: number;
	private debounceMs: number;
	private timer: NodeJS.Timeout | null = null;
	private pending: { stats: PlayerStats[]; todayStats: PlayerStats[] } | null = null;

	constructor(config: WebsitePublishConfig | undefined, private logger: Logger) {
		this.enabled = !!(config?.enabled && config.url && config.token);
		this.url = config?.url ?? "";
		this.token = config?.token ?? "";
		this.timeoutMs = config?.timeoutMs ?? 5000;
		this.debounceMs = config?.debounceMs ?? 5000;
		if (config?.enabled && !this.enabled) {
			this.logger.warn("Website: push enabled but url/token missing in config.secrets.json — skipping");
		}
	}

	// Latest stats win — bursts of updates collapse into one request.
	publish(stats: PlayerStats[], todayStats: PlayerStats[]): void {
		if (!this.enabled) return;
		this.pending = { stats, todayStats };
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			this.flush().catch(() => { /* flush never rejects, belt and braces */ });
		}, this.debounceMs);
	}

	async flush(): Promise<boolean> {
		if (!this.enabled || !this.pending) return false;
		const { stats, todayStats } = this.pending;
		this.pending = null;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const res = await fetch(this.url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Scoreboard-Token": this.token,
				},
				body: JSON.stringify({ stats, todayStats, lastUpdated: new Date().toISOString() }),
				signal: controller.signal,
			});
			if (res && !res.ok) {
				this.logger.warn(`Website: scoreboard push replied ${res.status}`);
				return false;
			}
			this.logger.info(`Website: scoreboard pushed (${stats.length} players)`);
			return true;
		} catch (err: any) {
			this.logger.warn(`Website: scoreboard push failed: ${err?.message}`);
			return false;
		} finally {
			clearTimeout(timer);
		}
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.pending = null;
	}
}
