import { describe, expect, it } from "vitest";
import { loudnessStats } from ".";
import { read } from "../../sources/read";
import { audio } from "../../utils/test-binaries";

const testVoice = audio.testVoice;

describe("loudness-stats", () => {
	it("processes voice audio and produces stats", async () => {
		const target = loudnessStats();
		const source = read(testVoice);

		source.to(target);

		await source.render();

		expect(target.stats).toBeDefined();
		expect(target.stats!.integrated).toBeGreaterThan(-70);
		expect(target.stats!.integrated).toBeLessThan(0);
	}, 240_000);
});
