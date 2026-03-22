import type { Snapshot } from "valtio/vanilla";
import type { Mutable } from "../State";

export class ProxyStore {
	private readonly _map = new Map<symbol, object>();

	dangerouslyGetProxy<T extends object>(key: symbol): T | undefined {
		return this._map.get(key) as T | undefined;
	}

	dangerouslySetProxy(key: symbol, value: object): void {
		this._map.set(key, value);
	}

	mutate<T extends { _key: symbol }>(snapshot: Snapshot<T>, callback: (proxy: Mutable<T>) => void): void {
		const proxy = this._map.get(snapshot._key);

		if (!proxy) {
			if (import.meta.env.DEV) console.warn("ProxyStore.mutate: proxy not found for key", snapshot._key);

			return;
		}

		callback(proxy as Mutable<T>);
	}
}
