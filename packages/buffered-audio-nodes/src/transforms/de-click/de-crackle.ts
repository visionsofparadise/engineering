import { z } from "zod";
import { DeClickNode, type DeClickProperties } from ".";
import type { BufferedAudioNodeInput } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";

/**
 * DeCrackle is a preset subclass of DeClick tuned for continuous crackle
 * material — vinyl surface crackle, tape oxide dropouts, electrical crackle.
 * Crackle events are typically briefer than speech mouth clicks (< 1 ms)
 * and occur at higher density, so the default `clickWidening` is smaller
 * and `maxClickDuration` is tighter than in base DeClick.
 *
 * `minFrequency` / `maxFrequency` are left unrestricted (inherited base
 * defaults: `minFrequency = 0`, `maxFrequency = undefined`). Vinyl and tape
 * crackle is broadband — unlike mouth clicks it occupies the full audio
 * spectrum, so the RX mouth-declick 100 Hz – 5 kHz band-restriction that
 * `MouthDeClick` uses is not applicable here. A future listening-test pass
 * may narrow this (e.g. 200–16000 Hz to reject DC rumble and ultrasonic
 * content) but the conservative default is no band restriction. See
 * design-declick decision log 2026-04-24 band-restriction entry.
 *
 * Only parameter defaults differ — the algorithm is the same BMRI
 * pipeline as `DeClick`.
 */
export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.6).describe("Sensitivity"),
	frequencySkew: z.number().min(-1).max(1).multipleOf(0.01).default(0).describe("Frequency Skew"),
	clickWidening: z.number().min(0).max(1).multipleOf(0.01).default(0.1).describe("Click Widening"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(20).describe("Max Click Duration (ms)"),
});

export interface DeCrackleProperties extends Omit<DeClickProperties, keyof z.infer<typeof schema>>, z.infer<typeof schema> {}

export class DeCrackleNode extends DeClickNode<DeCrackleProperties> {
	static override readonly moduleName: string = "De-Crackle";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly schema = schema;

	static override is(value: unknown): value is DeCrackleNode {
		return DeClickNode.is(value) && value.type[3] === "de-crackle";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-click", "de-crackle"];

	constructor(properties?: BufferedAudioNodeInput<DeCrackleProperties>) {
		const parsed = schema.parse(properties ?? {});

		super({ ...properties, ...parsed } as BufferedAudioNodeInput<DeCrackleProperties>);
	}

	override clone(overrides?: Partial<DeCrackleProperties>): DeCrackleNode {
		return new DeCrackleNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deCrackle(options?: {
	sensitivity?: number;
	frequencySkew?: number;
	clickWidening?: number;
	maxClickDuration?: number;
	id?: string;
}): DeCrackleNode {
	return new DeCrackleNode({ ...(options ?? {}), id: options?.id } as BufferedAudioNodeInput<DeCrackleProperties>);
}
