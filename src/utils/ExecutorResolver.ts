import { ExecutorRef, LightSharkExecutor } from "../types/index";

export function resolveExecutor(
	ref: ExecutorRef,
	executors: Record<string, LightSharkExecutor> = {},
): LightSharkExecutor {
	if (typeof ref === "string") {
		const e = executors[ref];
		if (!e) throw new Error(`Unknown executor name: "${ref}" — add it to config.executors`);
		return e;
	}
	return ref;
}
