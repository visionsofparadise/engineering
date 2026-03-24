import { Handle, type Position } from "@xyflow/react";

export function Port({ type, position }: { type: "source" | "target"; position: Position }) {
	return (
		<Handle
			type={type}
			position={position}
			className="!h-2.5 !w-2.5 !rounded-full !border !border-border !bg-[var(--surface-control)]"
			style={{ boxShadow: "var(--shadow-raised)" }}
		/>
	);
}
