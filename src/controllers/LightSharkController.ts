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

	private createMessage(address: string, floatValue: number = 0.0): Message {
		const msg = new Message(address);
		msg.append({ type: "f", value: floatValue });
		return msg;
	}

	async testConnection(): Promise<boolean> {
		try {
			const client = this.getClient();
			const msg = this.createMessage("/LS/Sync");

			return new Promise((resolve) => {
				client.send(msg, (err: Error | null) => {
					if (err) {
						this.logger.error(`LightShark OSC test failed: ${err.message}`);
						resolve(false);
					} else {
						resolve(true);
					}
				});
			});
		} catch (err) {
			this.logger.error(`LightShark test failed: ${err}`);
			return false;
		}
	}

	async triggerExecutor(executor: LightSharkExecutor): Promise<boolean> {
		try {
			const client = this.getClient();
			const { page, column, row } = executor;
			const address = `/LS/Executor/${page}/${column}/${row}`;
			const msg = this.createMessage(address, 0.0);

			return new Promise((resolve) => {
				client.send(msg, (err: Error | null) => {
					if (err) {
						this.logger.error(`LightShark error: ${err.message}`);
						resolve(false);
					} else {
						this.logger.debug(
							`✓ LightShark executor ${page}/${column}/${row} triggered`,
						);
						resolve(true);
					}
				});
			});
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
