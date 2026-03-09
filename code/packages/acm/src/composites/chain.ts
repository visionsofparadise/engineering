import type { AudioChainModule } from "../module";
import type { SourceModule } from "../source";
import type { TargetModule } from "../target";
import type { TransformModule } from "../transform";

export function chain<S extends SourceModule>(source: S, ...rest: Array<TransformModule | TargetModule>): S;
export function chain(...units: Array<AudioChainModule>): AudioChainModule;
export function chain(...units: Array<AudioChainModule>): AudioChainModule {
	if (units.length === 0) {
		throw new Error("chain() requires at least one module");
	}

	for (let index = 0; index < units.length - 1; index++) {
		const current = units[index];
		const next = units[index + 1];
		if (current && next) current.to(next);
	}

	const head = units[0];

	if (!head) throw new Error("chain() requires at least one module");

	return head;
}
