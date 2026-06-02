import * as knx from "knx";
import { Logger } from "../utils/Logger";
import { KNXConfig, KNXAction } from "../types/index";

export class KNXController {
	private connection: knx.Connection | null = null;
	private connected = false;

	constructor(
		private config: KNXConfig,
		private logger: Logger,
	) {}

	async connect(): Promise<boolean> {
		return new Promise((resolve) => {
			this.connection = new knx.Connection({
				ipAddr: this.config.gateway,
				ipPort: this.config.port || 3671,
				handlers: {
					connected: () => {
						this.connected = true;
						this.logger.success("✓ KNX connection OK");
						resolve(true);
					},
					error: (status: string) => {
						this.logger.error(`KNX connection failed: ${status}`);
						this.connected = false;
						resolve(false);
					},
				},
			});
		});
	}

	write(groupAddress: string, value: number, dpt: string = "DPT5.010"): void {
		if (!this.connected || !this.connection) {
			this.logger.warn("KNX: Not connected, cannot write");
			return;
		}

		try {
			const dp = new knx.Datapoint({ ga: groupAddress, dpt }, this.connection);
			dp.write(value);
			this.logger.debug(`KNX: Wrote ${value} to ${groupAddress}`);
		} catch (err) {
			this.logger.error(`KNX write error to ${groupAddress}: ${err}`);
		}
	}

	triggerAction(actionName: string): void {
		const action =
			this.config.actions?.[actionName as keyof typeof this.config.actions];
		if (!action) {
			this.logger.debug(`KNX: No action configured for: ${actionName}`);
			return;
		}

		const commands = Array.isArray(action) ? action : [action];
		commands.forEach((cmd: KNXAction) => {
			this.write(cmd.ga, cmd.value, cmd.dpt || "DPT5.010");
		});

		this.logger.info(`KNX: ${actionName} → ${commands.length} command(s)`);
	}

	disconnect(): void {
		if (this.connection) {
			(this.connection as any).Disconnect();
			this.connected = false;
		}
	}
}
