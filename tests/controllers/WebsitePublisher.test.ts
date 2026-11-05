import { WebsitePublisher } from "../../src/controllers/WebsitePublisher";

const logger: any = { info: () => {}, warn: jest.fn(), debug: () => {}, error: () => {}, success: () => {} };

const player = (nickname: string, wins = 1): any => ({
	nickname, gamesPlayed: 2, wins, winPct: 50, eliminations: 0, eliminated: 0,
	oneEighties: 0, hundredPlus: 0, highestRound: 0, busts: 0, highestCheckout: 0,
});

const config = { enabled: true, url: "https://example.test/wp-json/dart/v1/scoreboard", token: "secret", debounceMs: 1000 };

describe("WebsitePublisher", () => {
	let fetchMock: jest.Mock;

	beforeEach(() => {
		jest.useFakeTimers();
		fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
		(global as any).fetch = fetchMock;
		logger.warn.mockClear();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("does nothing when disabled or unconfigured", async () => {
		for (const cfg of [undefined, { enabled: false, url: "x", token: "y" }, { enabled: true, url: "x" }]) {
			const pub = new WebsitePublisher(cfg as any, logger);
			pub.publish([player("Laser")], []);
			jest.runAllTimers();
			expect(await pub.flush()).toBe(false);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("warns once when enabled but url is missing", () => {
		new WebsitePublisher({ enabled: true, token: "y" }, logger);
		new WebsitePublisher({ enabled: false }, logger);
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});

	it("posts stats with the token header", async () => {
		const pub = new WebsitePublisher(config, logger);
		pub.publish([player("Laser")], [player("Laser")]);
		expect(await pub.flush()).toBe(true);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(config.url);
		expect(init.method).toBe("POST");
		expect(init.headers["X-Scoreboard-Token"]).toBe("secret");
		const body = JSON.parse(init.body);
		expect(body.stats[0].nickname).toBe("Laser");
		expect(body.todayStats).toHaveLength(1);
		expect(typeof body.lastUpdated).toBe("string");
	});

	it("debounces bursts and sends only the latest stats", async () => {
		const pub = new WebsitePublisher(config, logger);
		pub.publish([player("Laser", 1)], []);
		pub.publish([player("Laser", 2)], []);
		pub.publish([player("Laser", 3)], []);
		jest.advanceTimersByTime(1000);
		await Promise.resolve();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).stats[0].wins).toBe(3);
	});

	it("swallows network errors and non-OK replies", async () => {
		const pub = new WebsitePublisher(config, logger);

		fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		pub.publish([player("Laser")], []);
		await expect(pub.flush()).resolves.toBe(false);

		fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
		pub.publish([player("Laser")], []);
		await expect(pub.flush()).resolves.toBe(false);

		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it("stop() cancels a pending push", () => {
		const pub = new WebsitePublisher(config, logger);
		pub.publish([player("Laser")], []);
		pub.stop();
		jest.runAllTimers();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
