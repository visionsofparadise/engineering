import { useLayoutEffect, useRef } from "react";

interface Watchable {
	watch: (callback: () => void) => () => void;
}

export const useTransients = <T extends Watchable>(watchables: Array<T>, callback: () => void): void => {
	const callbackRef = useRef(callback);
	const rafIdRef = useRef<number | null>(null);
	const isFirstCallRef = useRef(true);

	useLayoutEffect(() => {
		callbackRef.current = callback;
	});

	useLayoutEffect(() => {
		isFirstCallRef.current = true;

		const unsubs = watchables.map((watchable) =>
			watchable.watch(() => {
				if (isFirstCallRef.current) {
					isFirstCallRef.current = false;

					callbackRef.current();

					return;
				}

				if (rafIdRef.current !== null) return;

				rafIdRef.current = requestAnimationFrame(() => {
					rafIdRef.current = null;

					callbackRef.current();
				});
			}),
		);

		return () => {
			unsubs.forEach((unsub) => unsub());

			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
			}
		};
	}, [watchables]);
};
