import { ref } from "valtio/vanilla";

class StateRef<T> {
	private _value: { current: T };

	constructor(initial: T) {
		this._value = ref({ current: initial });
	}

	get current(): T {
		return this._value.current;
	}

	set(value: T): void {
		this._value.current = value;
	}
}

export namespace Transient {
	export type Listener<V> = (value: V) => void;

	export interface Options<V> {
		default?: V;
		minimum?: V;
		maximum?: V;
	}
}

export class Transient<V> {
	_committed: V;
	protected _transient = new StateRef<V | undefined>(undefined);
	isDirty = false;

	readonly default?: V;
	readonly minimum?: V;
	readonly maximum?: V;

	protected _listeners = new StateRef<Set<Transient.Listener<V>>>(new Set());

	private readonly _committedAccessor: { value: V };
	private readonly _transientAccessor: { value: V | undefined };

	constructor(value: V, options?: Transient.Options<V>) {
		this._committed = value;
		this.default = options?.default;
		this.minimum = options?.minimum;
		this.maximum = options?.maximum;

		// Cache accessor objects
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const _this = this;

		this._committedAccessor = {
			get value() {
				return _this._committed;
			},
			set value(newValue: V) {
				_this._committed = _this.applyClamp(newValue);
				_this._transient.set(undefined);
				_this.isDirty = false;
				_this.notify();
			},
		};

		this._transientAccessor = ref({
			set value(value: V | undefined) {
				if (value !== undefined) {
					_this._transient.set(_this.applyClamp(value));
					_this.isDirty ||= true;
				} else {
					_this._transient.set(undefined);
					_this.isDirty = false;
				}
				_this.notify();
			},
		});
	}

	get value(): V {
		return this._transient.current ?? this._committed;
	}

	get committed(): { value: V } {
		return this._committedAccessor;
	}

	get transient(): { value: V | undefined } {
		return this._transientAccessor;
	}

	watch(listener: Transient.Listener<V>): () => void {
		listener(this.value);
		this._listeners.current.add(listener);
		return () => this._listeners.current.delete(listener);
	}

	reset(): void {
		if (this.default !== undefined) {
			this.committed.value = this.default;
		}
	}

	toJson(): V {
		return this._committed;
	}

	protected applyClamp(value: V): V {
		if (this.minimum !== undefined || this.maximum !== undefined) {
			if (typeof value === "number" && typeof this.minimum === "number" && typeof this.maximum === "number") {
				return Math.max(this.minimum, Math.min(this.maximum, value)) as unknown as V;
			}
			if (typeof value === "number" && typeof this.minimum === "number") {
				return Math.max(this.minimum, value) as unknown as V;
			}
			if (typeof value === "number" && typeof this.maximum === "number") {
				return Math.min(this.maximum, value) as unknown as V;
			}
		}
		return value;
	}

	protected notify(): void {
		this._listeners.current.forEach((listener) => listener(this.value));
	}
}
