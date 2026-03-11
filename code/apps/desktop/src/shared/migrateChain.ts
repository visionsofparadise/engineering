import type { ChainDefinition } from "@engineering/acm";

const LEGACY_MODULE_NAMES: Record<string, string> = {
	"normalize": "Normalize",
	"de-click": "De-Click",
	"de-clip": "De-Clip",
	"de-reverb": "De-Reverb",
	"de-plosive": "De-Plosive",
	"breath-control": "Breath Control",
	"dither": "Dither",
	"leveler": "Leveler",
	"loudness": "Loudness",
	"trim": "Trim",
	"reverse": "Reverse",
	"resample": "Resample",
	"phase": "Phase",
	"time-stretch": "Time Stretch",
	"pitch-shift": "Pitch Shift",
	"waveform": "Waveform",
	"spectrogram": "Spectrogram",
};

export function migrateChain(chain: ChainDefinition): ChainDefinition {
	const transforms = chain.transforms.map((ref) => {
		const newName = LEGACY_MODULE_NAMES[ref.module];
		return newName ? { ...ref, module: newName } : ref;
	});

	return { ...chain, transforms };
}
