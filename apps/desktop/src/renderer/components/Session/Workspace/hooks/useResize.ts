import { useEffect } from "react";
import type { SessionContext } from "../../../../models/Context";

export function useWorkspaceResize(containerRef: React.RefObject<HTMLDivElement | null>, context: SessionContext): void {
	const { workspace, sessionStore } = context;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;

			sessionStore.mutate(workspace, (proxy) => {
				proxy.viewportWidth.committed.value = entry.contentRect.width;
				proxy.viewportHeight.committed.value = entry.contentRect.height;
			});
		});

		observer.observe(container);
		return () => observer.disconnect();
	}, [containerRef, workspace, sessionStore]);
}
