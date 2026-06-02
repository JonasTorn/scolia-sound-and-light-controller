import { ParsedThrow } from "../types/index";

export class SectorParser {
	static parse(sector: string | null | undefined): ParsedThrow {
		if (!sector) return { points: 0, multiplier: 0, segment: 0 };

		const s = sector.toLowerCase();

		// Bull (inner/outer distinguished by Scolia via multiplier in payload)
		if (s === "bull" || s === "25" || s === "50") {
			return { points: 25, multiplier: 1, segment: 25 };
		}

		// Miss
		if (s === "none" || s === "miss" || s === "0") {
			return { points: 0, multiplier: 0, segment: 0 };
		}

		// Single (s), Double (d), Triple (t) - e.g. "s20", "d16", "t19"
		const match = s.match(/^([sdt])(\d+)$/);
		if (match) {
			const type = match[1];
			const seg = parseInt(match[2], 10);
			const mult = type === "t" ? 3 : type === "d" ? 2 : 1;
			return { points: seg * mult, multiplier: mult, segment: seg };
		}

		return { points: 0, multiplier: 0, segment: 0 };
	}
}
