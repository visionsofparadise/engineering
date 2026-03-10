type Serialized<T> = T extends undefined | ((...args: Array<unknown>) => unknown)
	? never
	: T extends Array<infer V>
		? Array<Serialized<V>>
		: T extends object
			? { [K in keyof T as Serialized<T[K]> extends never ? never : K]: Serialized<T[K]> }
			: T;

export const serialize = <T>(value: T): Serialized<T> => {
	if (value === null) {
		return value as Serialized<T>;
	}

	if (value === undefined || typeof value === "function") {
		return undefined as Serialized<T>;
	}

	if (typeof value !== "object") {
		return value as Serialized<T>;
	}

	if (Array.isArray(value)) {
		return value.map(serialize) as Serialized<T>;
	}

	return serializeObject(value) as Serialized<T>;
};

const serializeObject = (source: object): object | undefined => {
	const result: Record<string, unknown> = {};

	for (const [key, childValue] of Object.entries(source) as Array<[string, unknown]>) {
		const serialized = serialize(childValue);

		if (serialized !== undefined) {
			result[key] = serialized;
		}
	}

	if (Object.keys(result).length === 0) {
		return undefined;
	}

	return result;
};
