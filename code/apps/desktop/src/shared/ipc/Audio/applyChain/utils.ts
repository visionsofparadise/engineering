import {
	BreathControlTransformModule,
	DeClickTransformModule,
	DeClipTransformModule,
	DePlosiveTransformModule,
	DeReverbTransformModule,
	DitherTransformModule,
	LevelerTransformModule,
	LoudnessTransformModule,
	NormalizeTransformModule,
	PhaseTransformModule,
	PitchShiftTransformModule,
	ResampleTransformModule,
	ReverseModule,
	TimeStretchTransformModule,
	TrimModule,
} from "@engineering/acm";
import type { z } from "zod";

export interface ModuleClass {
	readonly moduleName: string;
	readonly moduleDescription: string;
	readonly schema: z.ZodType;
}

const MODULES: ReadonlyArray<ModuleClass> = [
	NormalizeTransformModule,
	DeClickTransformModule,
	DeClipTransformModule,
	DeReverbTransformModule,
	DePlosiveTransformModule,
	BreathControlTransformModule,
	DitherTransformModule,
	LevelerTransformModule,
	LoudnessTransformModule,
	TrimModule,
	ReverseModule,
	ResampleTransformModule,
	PhaseTransformModule,
	TimeStretchTransformModule,
	PitchShiftTransformModule,
];

export const MODULE_REGISTRY: ReadonlyMap<string, ModuleClass> = new Map(
	MODULES.map((module) => [module.moduleName, module]),
);
