import { useEffect, useRef } from "react";
import type { Transient } from "../models/Transient";

export function useTransients(transients: ReadonlyArray<Transient<unknown>>, callback: () => void): void {
	const callbackRef = useRef(callback);

	callbackRef.current = callback;

	const rafRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		let isFirst = true;

		const listener = () => {
			if (isFirst) {
				isFirst = false;
				callbackRef.current();

				return;
			}

			rafRef.current ??= requestAnimationFrame(() => {
				rafRef.current = undefined;
				callbackRef.current();
			});
		};

		const unsubscribes = transients.map((tr) => tr.watch(listener));

		return () => {
			for (const unsub of unsubscribes) {
				unsub();
			}

			if (rafRef.current !== undefined) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = undefined;
			}
		};
		 
	}, transients);
}
