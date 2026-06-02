import { GameThrow, SpecialEventMatch } from "../types/index";
import { specialEventsConfig } from "../config/specialEvents.config";

export class SpecialEventDetector {
	detect(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
	): SpecialEventMatch | null {
		// Try each special event in order (first match wins)
		for (const eventDef of specialEventsConfig) {
			if (!eventDef.enabled) continue;

			const isMatch = this.checkPattern(
				eventDef.detector,
				eventDef.params,
				throwHistory,
				currentThrow,
			);
			if (isMatch) {
				return {
					eventName: eventDef.name,
					sound: eventDef.sound,
					effects: eventDef.effects,
				};
			}
		}

		return null;
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
			case "doubleOhSeven":
				return this.doubleOhSeven(throwHistory, currentThrow);
			case "nineteenOhFour":
				return this.nineteenOhFour(throwHistory, currentThrow);
			case "fourOhFour":
				return this.fourOhFour(throwHistory, currentThrow);
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

		// Check if each throw matches the expected point value in the pattern
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
		const { segments, multiplier } = params;
		if (throwHistory.length < segments.length - 1) return false;

		const lastN = throwHistory.slice(-(segments.length - 1));
		const sequence = [...lastN, currentThrow];

		for (let i = 0; i < segments.length; i++) {
			const t = sequence[i];
			// Check segment and multiplier match
			if (multiplier === "single" && t.multiplier !== 1) return false;
			if (t.segment !== segments[i]) return false;
		}

		return true;
	}

	private doubleOhSeven(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
	): boolean {
		// Pattern: miss, miss, single 7
		if (throwHistory.length < 2) return false;

		const last2 = throwHistory.slice(-2);
		return (
			last2[0].points === 0 &&
			last2[1].points === 0 &&
			currentThrow.segment === 7 &&
			currentThrow.multiplier === 1
		);
	}

	private nineteenOhFour(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
	): boolean {
		// Pattern: single 19, miss, single 4
		if (throwHistory.length < 2) return false;

		const last2 = throwHistory.slice(-2);
		return (
			last2[0].segment === 19 &&
			last2[0].multiplier === 1 &&
			last2[1].points === 0 &&
			currentThrow.segment === 4 &&
			currentThrow.multiplier === 1
		);
	}

	private fourOhFour(
		throwHistory: GameThrow[],
		currentThrow: GameThrow,
	): boolean {
		// Pattern: single 4, miss, single 4
		if (throwHistory.length < 2) return false;

		const last2 = throwHistory.slice(-2);
		return (
			last2[0].segment === 4 &&
			last2[0].multiplier === 1 &&
			last2[1].points === 0 &&
			currentThrow.segment === 4 &&
			currentThrow.multiplier === 1
		);
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
