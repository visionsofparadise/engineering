import { describe, expect, it } from "vitest";
import { contentHash } from "./contentHash";

describe("contentHash", () => {
	const base = {
		upstreamHash: "abc123",
		packageName: "buffered-audio-nodes",
		packageVersion: "0.2.0",
		nodeName: "normalize",
		parameters: { threshold: -1, ceiling: 0 },
		bypass: false,
	} as const;

	it("returns a 16-character hex string", () => {
		const hash = contentHash(
			base.upstreamHash,
			base.packageName,
			base.packageVersion,
			base.nodeName,
			base.parameters,
			base.bypass,
		);

		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});

	it("produces the same hash for the same inputs", () => {
		const a = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, base.parameters, base.bypass);
		const b = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, base.parameters, base.bypass);

		expect(a).toBe(b);
	});

	it("produces a different hash when any input changes", () => {
		const original = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, base.parameters, base.bypass);

		const withDifferentNode = contentHash(base.upstreamHash, base.packageName, base.packageVersion, "compress", base.parameters, base.bypass);
		const withDifferentBypass = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, base.parameters, true);
		const withDifferentParams = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, { threshold: -2 }, base.bypass);

		expect(withDifferentNode).not.toBe(original);
		expect(withDifferentBypass).not.toBe(original);
		expect(withDifferentParams).not.toBe(original);
	});

	it("produces the same hash regardless of parameter key order", () => {
		const a = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, { a: 1, b: 2 }, base.bypass);
		const b = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, { b: 2, a: 1 }, base.bypass);

		expect(a).toBe(b);
	});

	it("produces the same hash regardless of nested object key order", () => {
		const a = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, { outer: { x: 1, y: 2 } }, base.bypass);
		const b = contentHash(base.upstreamHash, base.packageName, base.packageVersion, base.nodeName, { outer: { y: 2, x: 1 } }, base.bypass);

		expect(a).toBe(b);
	});

	it("works for source nodes with empty upstream hash", () => {
		const hash = contentHash("", base.packageName, base.packageVersion, base.nodeName, base.parameters, base.bypass);

		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});
});
