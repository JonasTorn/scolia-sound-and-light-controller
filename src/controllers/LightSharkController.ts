import { Client, Message } from "node-osc";
import { Logger } from "../utils/Logger";
import { LightSharkExecutor } from "../types/index";

export class LightSharkController {
	private client: Client | null = null;

	constructor(
		private config: { ip: string; oscPort: number },
		private logger: Logger,
	) {}

	private getClient(): Client {
		if (!this.client) {
			this.client = new Client(this.config.ip, this.config.oscPort);
		}
		return this.client;
	}

	private send(address: string, value = 0.0): Promise<boolean> {
		const msg = new Message(address);
		msg.append({ type: "f", value });
		return new Promise((resolve) => {
			this.getClient().send(msg, (err: Error | null) => {
				if (err) {
					this.logger.error(`LightShark OSC error: ${err.message}`);
					resolve(false);
				} else {
					resolve(true);
				}
			});
		});
	}

	async testConnection(): Promise<boolean> {
		try {
			return await this.send("/LS/Sync");
		} catch (err) {
			this.logger.error(`LightShark test failed: ${err}`);
			return false;
		}
	}

	async triggerExecutor(executor: LightSharkExecutor): Promise<boolean> {
		return this.sendToExecutor(executor, 0.0);
	}

	// Flash/Push mode only: explicitly start the effect (idempotent)
	async startExecutor(executor: LightSharkExecutor): Promise<boolean> {
		return this.sendToExecutor(executor, 1.0);
	}

	private async sendToExecutor(executor: LightSharkExecutor, value: number): Promise<boolean> {
		try {
			const { page, column, row } = executor;
			const success = await this.send(`/LS/Executor/${page}/${column}/${row}`, value);
			if (success) {
				this.logger.debug(`✓ LightShark executor ${page}/${column}/${row} ${value === 1.0 ? "started" : "triggered"} (${value})`);
			}
			return success;
		} catch (err) {
			this.logger.error(`LightShark error: ${err}`);
			return false;
		}
	}

	close(): void {
		if (this.client) {
			this.client.close();
			this.client = null;
		}
	}
}
