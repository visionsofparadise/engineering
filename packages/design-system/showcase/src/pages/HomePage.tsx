import { Icon } from "@iconify/react";
import { TerrainShader } from "../components/TerrainShader";

const RECENT_SESSIONS = [
	{
		name: "Podcast Episode 47",
		path: "/recordings/ep47",
		duration: "01:23:45",
		lastOpened: "2 hours ago",
	},
	{
		name: "Interview \u2014 Sarah Chen",
		path: "/recordings/interviews",
		duration: "00:45:12",
		lastOpened: "Yesterday",
	},
	{
		name: "Audiobook Ch 12",
		path: "/recordings/audiobook",
		duration: "02:10:30",
		lastOpened: "3 days ago",
	},
	{
		name: "Sound Design \u2014 Intro",
		path: "/recordings/sfx",
		duration: "00:02:15",
		lastOpened: "Last week",
	},
	{
		name: "Voiceover \u2014 Ad Read",
		path: "/recordings/vo",
		duration: "00:01:42",
		lastOpened: "Last week",
	},
	{
		name: "Lecture Recording",
		path: "/recordings/edu",
		duration: "01:15:08",
		lastOpened: "2 weeks ago",
	},
] as const;

export function HomePage() {
	return (
		<div className="relative h-full overflow-hidden bg-void">
			<TerrainShader className="absolute inset-0" />

			<div className="relative flex h-full flex-col p-4">
				<h1 className="font-display text-[length:6rem] font-bold leading-none tracking-tight text-chrome-text">ENGINEERING</h1>

				<div className="flex-1" />

				<div className="flex flex-col gap-6">
					<div className="flex flex-col gap-4">
						<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-widest text-chrome-text-dim">Recent Sessions</span>

						<div className="flex flex-col gap-2">
							{RECENT_SESSIONS.map((session) => (
								<button
									key={session.path}
									type="button"
									className="flex w-fit items-baseline gap-5 text-left transition-colors duration-100 hover:bg-secondary"
								>
									<span className="font-body text-[length:var(--text-base)] text-chrome-text">{session.name}</span>
									<span className="font-technical text-[length:var(--text-xs)] text-chrome-text-dim">{session.path}</span>
									<span className="font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{session.duration}</span>
									<span className="font-technical text-[length:var(--text-xs)] text-chrome-text-dim">{session.lastOpened}</span>
								</button>
							))}
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<button
							type="button"
							className="flex w-fit items-center gap-2 bg-primary font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-void transition-colors hover:brightness-110"
						>
							<Icon
								icon="lucide:plus"
								width={16}
							/>
							New Session
						</button>
						<button
							type="button"
							className="flex w-fit items-center gap-2 bg-secondary font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text transition-colors hover:brightness-125"
						>
							<Icon
								icon="lucide:folder-open"
								width={16}
							/>
							Open Session
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
