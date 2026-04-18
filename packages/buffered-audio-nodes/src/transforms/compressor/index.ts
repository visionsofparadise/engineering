import { z } from "zod";
import { TransformNode, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { DynamicsStream } from "../dynamics";

export const schema = z.object({
	threshold: z.number().min(-60).max(0).multipleOf(0.1).default(-24).describe("Threshold (dBFS)"),
	ratio: z.number().min(1).max(20).multipleOf(0.1).default(4).describe("Ratio"),
	attack: z.number().min(0).max(500).multipleOf(0.1).default(10).describe("Attack (ms)"),
	release: z.number().min(0).max(5000).multipleOf(1).default(100).describe("Release (ms)"),
	knee: z.number().min(0).max(24).multipleOf(0.1).default(6).describe("Knee (dB)"),
	makeupGain: z.number().min(-24).max(24).multipleOf(0.1).default(0).describe("Makeup Gain (dB)"),
	detection: z.enum(["peak", "rms"]).default("peak").describe("Detection mode"),
	stereoLink: z.enum(["average", "max", "none"]).default("average").describe("Stereo link"),
});

export interface CompressorProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Compressor: a specialized API over the shared DynamicsStream.
 *
 * Provides a clean compression-focused schema without exposing the full
 * DynamicsNode control surface (no `mode`, `lookahead`, or `oversampling`).
 *
 * `createStream()` returns a DynamicsStream directly; there is no
 * CompressorStream wrapper class. The compressor's restricted params are
 * translated to the full DynamicsProperties surface, with `mode: "downward"`,
 * `lookahead: 0`, and `oversampling: 1` hardcoded.
 */
export class CompressorNode extends TransformNode<CompressorProperties> {
	static override readonly moduleName = "Compressor";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Dynamic range compressor";
	static override readonly schema = schema;
	static override is(value: unknown): value is CompressorNode {
		return TransformNode.is(value) && value.type[2] === "compressor";
	}

	override readonly type = ["buffered-audio-node", "transform", "compressor"] as const;

	override createStream(): DynamicsStream {
		const { threshold, ratio, attack, release, knee, makeupGain, detection, stereoLink } = this.properties;

		return new DynamicsStream({
			threshold,
			ratio,
			attack,
			release,
			knee,
			makeupGain,
			detection,
			stereoLink,
			lookahead: 0,
			mode: "downward",
			oversampling: 1,
			bufferSize: this.bufferSize,
			overlap: this.properties.overlap ?? 0,
		});
	}

	override clone(overrides?: Partial<CompressorProperties>): CompressorNode {
		return new CompressorNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function compressor(options?: Partial<CompressorProperties> & { id?: string }): CompressorNode {
	const parsed = schema.parse(options ?? {});

	return new CompressorNode({ ...parsed, id: options?.id });
}
