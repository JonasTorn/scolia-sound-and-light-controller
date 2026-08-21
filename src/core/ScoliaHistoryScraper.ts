import { Logger } from "../utils/Logger";
import { PlayerStats } from "../types/index";

// newPage factory is injected so this class never holds a browser context directly,
// making it easy to move to a standalone app later.
export type NewPageFn = () => Promise<import("playwright").Page | null>;

export class ScoliaHistoryScraper {
	constructor(
		private logger: Logger,
		private baseUrl: string,
	) {}

	async scrape(newPage: NewPageFn, players: string[]): Promise<PlayerStats[]> {
		// Stub: returns zeroed-out stats for each registered player.
		// TODO: Navigate to Scolia stats pages and extract real data.
		//
		// Discovery steps (run once with debug logs):
		//   1. Open a page → navigate to `${baseUrl}/profile` or `${baseUrl}/stats`
		//   2. Intercept fetch/XHR via page.route() or page.on("response", ...)
		//   3. Find the response URL that contains per-player stats JSON
		//   4. Parse the response and map to PlayerStats[]
		//
		// Once the URL is known, implement extraction here.

		this.logger.debug("Scoreboard: ScoliaHistoryScraper.scrape() — returning stub data (not yet implemented)");
		return players.map((nickname) => ({
			nickname,
			gamesPlayed: 0,
			wins: 0,
			winPct: 0,
			eliminations: 0,
		}));
	}

	// Call this once to help discover the Scolia stats URL.
	// Navigates to the profile page and logs all JSON API responses.
	async discoverStatsUrl(newPage: NewPageFn): Promise<void> {
		const page = await newPage();
		if (!page) return;

		this.logger.info("Scoreboard discovery: Navigating to Scolia profile page...");

		page.on("response", async (response) => {
			const url = response.url();
			const ct = response.headers()["content-type"] ?? "";
			if (!ct.includes("json")) return;
			try {
				const body = await response.text();
				if (body.length > 20 && body.length < 50000) {
					this.logger.info(`Scoreboard discovery: JSON response from ${url} (${body.length} bytes)`);
				}
			} catch {
				// ignore
			}
		});

		try {
			await page.goto(`${this.baseUrl}/profile`, { waitUntil: "networkidle", timeout: 20000 });
			this.logger.info("Scoreboard discovery: Profile page loaded — check logs above for JSON API calls");
		} catch (err) {
			this.logger.warn(`Scoreboard discovery: Navigation failed: ${err}`);
		} finally {
			await page.close().catch(() => {});
		}
	}
}
