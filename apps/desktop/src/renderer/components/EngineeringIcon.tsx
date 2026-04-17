import { useId } from "react";
import type { AppState } from "../models/State/App";

interface Props {
	readonly theme: AppState["theme"];
	readonly className?: string;
	readonly title?: string;
}

const GRADIENT_STOPS = {
	lava: [
		{ offset: "0%", color: "#0F1446" },
		{ offset: "18%", color: "#500A05" },
		{ offset: "42%", color: "#B93700" },
		{ offset: "68%", color: "#F09B19" },
		{ offset: "100%", color: "#FFF08C" },
	],
	viridis: [
		{ offset: "0%", color: "#482374" },
		{ offset: "20%", color: "#404487" },
		{ offset: "46%", color: "#218988" },
		{ offset: "72%", color: "#2AB65B" },
		{ offset: "100%", color: "#FDE725" },
	],
} satisfies Record<AppState["theme"], Array<{ offset: string; color: string }>>;

export function EngineeringIcon({ theme, className, title }: Props) {
	const gradientId = useId();

	return (
		<svg
			viewBox="0 0 1024 1024"
			className={className}
			aria-hidden={title ? undefined : true}
			role={title ? "img" : undefined}
		>
			{title && <title>{title}</title>}
			<defs>
				<linearGradient id={gradientId} x1="176" y1="512" x2="832" y2="512" gradientUnits="userSpaceOnUse">
					{GRADIENT_STOPS[theme].map((stop) => (
						<stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
					))}
				</linearGradient>
			</defs>
			<path
				fill={`url(#${gradientId})`}
				d="M176 128H832V272H336V432H704V592H336V752H832V896H176Z"
			/>
		</svg>
	);
}
