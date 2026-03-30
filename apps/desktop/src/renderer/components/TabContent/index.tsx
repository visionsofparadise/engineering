import type { AppContext } from "../../models/Context";
import { HomeScreen } from "../HomeScreen";

export function TabContent({ context }: { readonly context: AppContext }) {
	const activeTab = context.app.activeTabId
		? context.app.tabs.find((tab) => tab.id === context.app.activeTabId)
		: null;

	if (!activeTab) {
		return <HomeScreen context={context} />;
	}

	return (
		<div className="flex flex-1 items-center justify-center bg-chrome-base text-chrome-text-secondary font-technical uppercase tracking-[0.06em]">
			Graph view — not yet implemented
		</div>
	);
}
