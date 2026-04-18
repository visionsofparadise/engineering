import { z } from "zod";
import { TransformNode, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { DynamicsStream } from "../dynamics";

/** Hardcoded ratio for true limiting (effectively infinite) */
const LIMITER_RATIO = 100;

export const schema = z.object({
	threshold: z.number().min(-60).max(0).multipleOf(0.1).default(-1).describe("Threshold (dBFS)"),
	attack: z.number().min(0).max(100).multipleOf(0.1).default(1).describe("Attack (ms)"),
	release: z.number().min(0).max(5000).multipleOf(1).default(50).describe("Release (ms)"),
	makeupGain: z.number().min(-24).max(24).multipleOf(0.1).default(0).describe("Makeup Gain (dB)"),
	stereoLink: z.enum(["average", "max", "none"]).default("max").describe("Stereo link"),
	oversampling: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(2).describe("Oversampling factor (1 = off, 2/4/8 = internal-rate multiplier for alias-free nonlinear processing)"),
});

export interface LimiterProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Limiter: a specialized API over the shared DynamicsStream.
 *
 * Hardcodes ratio=100 (effectively infinite) and knee=0 (hard knee) for
 * true limiting behavior. Exposes a minimal control surface appropriate
 * for a brick-wall limiter. `oversampling` defaults to 2.
 *
 * `createStream()` returns a DynamicsStream directly; there is no
 * LimiterStream wrapper class.
 */
export class LimiterNode extends TransformNode<LimiterProperties> {
	static override readonly moduleName = "Limiter";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Brick-wall limiter — prevents signal from exceeding threshold";
	static override readonly schema = schema;
	static override is(value: unknown): value is LimiterNode {
		return TransformNode.is(value) && value.type[2] === "limiter";
	}

	override readonly type = ["buffered-audio-node", "transform", "limiter"] as const;

	override createStream(): DynamicsStream {
		const { threshold, attack, release, makeupGain, stereoLink, oversampling } = this.properties;

		return new DynamicsStream({
			threshold,
			ratio: LIMITER_RATIO,
			attack,
			release,
			knee: 0,
			makeupGain,
			detection: "peak",
			stereoLink,
			lookahead: 0,
			mode: "downward",
			oversampling,
			bufferSize: this.bufferSize,
			overlap: this.properties.overlap ?? 0,
		});
	}

	override clone(overrides?: Partial<LimiterProperties>): LimiterNode {
		return new LimiterNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function limiter(options?: Partial<LimiterProperties> & { id?: string }): LimiterNode {
	const parsed = schema.parse(options ?? {});

	return new LimiterNode({ ...parsed, id: options?.id });
}
