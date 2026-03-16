import { useCallback, useEffect, useRef } from "react";
import type { SessionContext } from "../../../../models/Context";

export function useWorkspaceResize(context: SessionContext): (node: HTMLDivElement | null) => void {
	const { workspace, sessionStore } = context;
	const observerRef = useRef<ResizeObserver | null>(null);

	const callbackRef = useCallback(
		(node: HTMLDivElement | null) => {
			if (observerRef.current) {
				observerRef.current.disconnect();
				observerRef.current = null;
			}

			if (!node) return;

			const rect = node.getBoundingClientRect();
			sessionStore.mutate(workspace, (proxy) => {
				proxy.viewportWidth.committed.value = rect.width;
				proxy.viewportHeight.committed.value = rect.height;
			});

			const observer = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (!entry) return;

				sessionStore.mutate(workspace, (proxy) => {
					proxy.viewportWidth.committed.value = entry.contentRect.width;
					proxy.viewportHeight.committed.value = entry.contentRect.height;
				});
			});

			observer.observe(node);
			observerRef.current = observer;
		},
		[workspace, sessionStore],
	);

	useEffect(
		() => () => {
			observerRef.current?.disconnect();
		},
		[],
	);

	return callbackRef;
}
