import { Effect, GameThrow, PlayerOverwrite, RoundConstraint, SpecialEventDefinition, ThrowEvent } from "../types/index";
import { specialEventsConfig } from "../config/events.config";
import { SectorParser } from "../utils/SectorParser";

export class SpecialEventDetector {
	constructor(private eventDefs: SpecialEventDefinition[] = specialEventsConfig) {}

	detect(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
		playerName?: string | null,
	): ThrowEvent | null {
		let best: { priority: number; event: ThrowEvent } | null = null;

		for (const eventDef of this.eventDefs) {
			if (!eventDef.enabled) continue;

			// Skip if event is restricted to specific players and current player isn't in the list
			if (eventDef.players?.length && !eventDef.players.includes(playerName ?? "")) continue;

			if (eventDef.roundConstraint && !this.checkRoundConstraint(eventDef.roundConstraint, throwHistory)) continue;

			const isMatch = this.checkPattern(
				eventDef.detector,
				eventDef.params,
				throwHistory,
				currentThrow,
			);
			if (!isMatch) continue;

			const priority = eventDef.priority ?? 0;
			if (best === null || priority > best.priority) {
				best = { priority, event: { name: eventDef.name, effects: this.buildEffects(eventDef, priority, playerName) } };
			}
		}

		return best?.event ?? null;
	}

	private buildEffects(eventDef: SpecialEventDefinition, priority: number, playerName?: string | null): Effect[] {
		const overwrite: PlayerOverwrite | undefined = playerName ? eventDef.playerOverwrites?.[playerName] : undefined;
		const effects: Effect[] = [];

		// Always push a sound effect — SoundController falls back to core/{name}.wav if no files set
		const sound = overwrite?.sound ?? eventDef.sound;
		effects.push({ type: "sound", event: eventDef.name, files: sound?.files, volume: sound?.volume, priority });

		const lights = overwrite?.lights ?? eventDef.lights ?? [];
		for (const light of lights) {
			effects.push({ type: "light", executor: light.executor, mode: light.mode });
		}

		const overlay = overwrite?.overlay ?? eventDef.overlay;
		if (overlay) {
			effects.push({ type: "overlay", file: overlay.file, durationMs: overlay.durationMs });
		}

		return effects;
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
			case "multiplierIs":
				return this.multiplierIs(throwHistory, currentThrow, params);
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
		const sum = lastN.reduce((acc, t) => acc + t.points, 0) + currentThrow.points;
		return this.evalSumCondition(targetSum, sum);
	}

	private evalSumCondition(condition: string | number, total: number): boolean {
		if (typeof condition === "number") return total === condition;
		const s = String(condition).trim();
		if (s.startsWith(">=")) return total >= parseInt(s.slice(2), 10);
		if (s.startsWith("<=")) return total <= parseInt(s.slice(2), 10);
		if (s.startsWith(">"))  return total >  parseInt(s.slice(1), 10);
		if (s.startsWith("<"))  return total <  parseInt(s.slice(1), 10);
		return total === parseInt(s, 10);
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

	// throwHistory does not include currentThrow, so length = number of prior throws this round.
	// throwNumber is 1-indexed: throw #1 → history.length === 0, throw #2 → history.length === 1, etc.
	private checkRoundConstraint(constraint: RoundConstraint, throwHistory: GameThrow[]): boolean {
		const throwNumber = throwHistory.length + 1;
		if (constraint.throwNumber !== undefined) {
			const allowed = Array.isArray(constraint.throwNumber) ? constraint.throwNumber : [constraint.throwNumber];
			if (!allowed.includes(throwNumber)) return false;
		}
		if (constraint.minThrow !== undefined && throwNumber < constraint.minThrow) return false;
		if (constraint.maxThrow !== undefined && throwNumber > constraint.maxThrow) return false;
		return true;
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

	private multiplierIs(
		_throwHistory: GameThrow[],
		currentThrow: GameThrow,
		params: Record<string, any>,
	): boolean {
		return currentThrow.multiplier === params.multiplier && currentThrow.segment !== 0;
	}
}
