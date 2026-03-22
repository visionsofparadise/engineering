import type { ChainModuleReference } from "../../shared/ipc/Audio/apply/Renderer";

export interface IdentifiedTransform extends ChainModuleReference {
	readonly id: string;
}

export interface IdentifiedChain {
	readonly label?: string;
	readonly transforms: Array<IdentifiedTransform>;
}
