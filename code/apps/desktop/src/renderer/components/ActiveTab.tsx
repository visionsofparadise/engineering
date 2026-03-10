import type { AppContext } from "../models/Context";
import { Session } from "./Session";
import { EmptyState } from "./Session/EmptyState";

interface ActiveTabProps {
	context: AppContext;
}

export const ActiveTab: React.FC<ActiveTabProps> = ({ context }: { context: AppContext }) => {
	const { app } = context;

	if (app.activeTabId === "batch") {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">Batch processing — coming soon</p>
			</div>
		);
	}

	const activeTab = app.tabs.find((tab) => tab.id === app.activeTabId);

	if (!activeTab) {
		return <EmptyState />;
	}

	return (
		<Session
			tab={activeTab}
			context={context}
		/>
	);
};
