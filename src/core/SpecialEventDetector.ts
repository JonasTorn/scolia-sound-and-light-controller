import { Effect, GameThrow, SpecialEventDefinition, ThrowEvent } from "../types/index";
import { specialEventsConfig } from "../config/events.config";
import { SectorParser } from "../utils/SectorParser";

export class SpecialEventDetector {
	constructor(private eventDefs: SpecialEventDefinition[] = specialEventsConfig) {}

	detect(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
	): ThrowEvent | null {
		let best: { priority: number; event: ThrowEvent } | null = null;

		for (const eventDef of this.eventDefs) {
			if (!eventDef.enabled) continue;

			const isMatch = this.checkPattern(
				eventDef.detector,
				eventDef.params,
				throwHistory,
				currentThrow,
			);
			if (!isMatch) continue;

			const priority = eventDef.priority ?? 0;
			if (best === null || priority > best.priority) {
				const effects: Effect[] = [];
				if (eventDef.sound || eventDef.playerSounds) {
					effects.push({
						type: "sound",
						event: eventDef.name,
						files: eventDef.sound?.files,
						volume: eventDef.sound?.volume,
						playerSounds: eventDef.playerSounds,
						priority,
					});
				}
				for (const light of eventDef.lights ?? []) {
					effects.push({ type: "light", executor: light.executor, mode: light.mode });
				}
				if (eventDef.overlay) {
					effects.push({ type: "overlay", file: eventDef.overlay.file, durationMs: eventDef.overlay.durationMs });
				}
				best = { priority, event: { name: eventDef.name, effects } };
			}
		}

		return best?.event ?? null;
	}

	private checkPattern(
		strategy: string,
		params: Record<string, any>,
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
	): boolean {
		switch (strategy) {
			case "sumLastN":
				return this.sumLastN(throwHistory, currentThrow, params);
			case "consecutivePattern":
				return this.consecutivePattern(throwHistory, currentThrow, params);
			case "sequentialSegments":
				return this.sequentialSegments(throwHistory, currentThrow, params);
			case "concatenatesTo":
				return this.concatenatesTo(throwHistory, currentThrow, params);
			case "consecutiveMisses":
				return this.consecutiveMisses(throwHistory, currentThrow, params);
			default:
				return false;
		}
	}

	private sumLastN(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
		params: Record<string, any>,
	): boolean {
		const { n, targetSum } = params;
		if (throwHistory.length < n - 1) return false;

		const lastN = throwHistory.slice(-(n - 1));
		const sum =
			lastN.reduce((acc, t) => acc + t.points, 0) + currentThrow.points;
		return sum === targetSum;
	}

	private consecutivePattern(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
		params: Record<string, any>,
	): boolean {
		const { pattern } = params;
		if (throwHistory.length < pattern.length - 1) return false;

		const lastN = throwHistory.slice(-(pattern.length - 1));
		const sequence = [...lastN, currentThrow];

		// Pattern values are point totals per throw (e.g. [60, 60] = two T20s)
		for (let i = 0; i < pattern.length; i++) {
			if (sequence[i].points !== pattern[i]) {
				return false;
			}
		}

		return true;
	}

	private sequentialSegments(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
		params: Record<string, any>,
	): boolean {
		const { throws } = params as { throws: string[] };
		if (throwHistory.length < throws.length - 1) return false;

		const n = throws.length - 1;
		const lastN = n > 0 ? throwHistory.slice(-n) : [];
		const sequence = [...lastN, currentThrow];

		for (let i = 0; i < throws.length; i++) {
			const expected = SectorParser.parse(throws[i]);
			const actual = sequence[i];
			if (actual.segment !== expected.segment || actual.multiplier !== expected.multiplier) return false;
		}

		return true;
	}

	// Matches when the scores of the last N throws concatenate (as digit strings)
	// to form params.number. E.g. number=1337, throws [13,3,7] → "13"+"3"+"7"="1337" ✓
	//                                              throws [1,33,7] → "1"+"33"+"7"="1337" ✓ (T11=33p)
	private concatenatesTo(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
		params: Record<string, any>,
	): boolean {
		const str = String(params.number);
		const n = 3;
		if (throwHistory.length < n - 1) return false;

		const lastN = throwHistory.slice(-(n - 1));
		const sequence = [...lastN, currentThrow];

		return this.stringSplits(str, n).some((parts) =>
			parts.every((part, i) => sequence[i].points === parseInt(part, 10)),
		);
	}

	// All ways to split str into exactly `parts` non-empty substrings (ordered).
	private stringSplits(str: string, parts: number): string[][] {
		if (parts === 1) return str.length > 0 ? [[str]] : [];
		const results: string[][] = [];
		for (let i = 1; i <= str.length - parts + 1; i++) {
			const first = str.slice(0, i);
			for (const rest of this.stringSplits(str.slice(i), parts - 1)) {
				results.push([first, ...rest]);
			}
		}
		return results;
	}

	private consecutiveMisses(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
		params: Record<string, any>,
	): boolean {
		const { count } = params;
		if (currentThrow.points !== 0) return false;
		if (throwHistory.length < count - 1) return false;

		const lastN = throwHistory.slice(-(count - 1));
		return lastN.every((t) => t.points === 0);
	}
}
