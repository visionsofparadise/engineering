import { useCallback, useRef } from "react";

export function useCanvasRef(ref: React.Ref<HTMLCanvasElement> | undefined) {
	const internalCanvasReference = useRef<HTMLCanvasElement | null>(null);
	const externalRefRef = useRef(ref);

	externalRefRef.current = ref;

	const canvasCallback = useCallback((canvas: HTMLCanvasElement | null) => {
		internalCanvasReference.current = canvas;

		const externalRef = externalRefRef.current;

		if (typeof externalRef === "function") {
			externalRef(canvas);
		} else if (externalRef) {
			externalRef.current = canvas;
		}
	}, []);

	return [internalCanvasReference, canvasCallback] as const;
}
