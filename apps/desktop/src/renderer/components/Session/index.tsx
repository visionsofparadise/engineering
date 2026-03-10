import { useMemo } from "react";
import type { AppContext, SessionContext } from "../../models/Context";
import type { TabEntry } from "../../models/State/App";
import { SessionLayout } from "./Layout";

interface SessionProps {
	tab: TabEntry;
	context: AppContext;
}

export const Session: React.FC<SessionProps> = ({ tab, context }) => {
	const sessionContext = useMemo(
		(): SessionContext => ({
			...context,
			sessionPath: tab.workingDir,
		}),
		[context, tab.workingDir],
	);

	return <SessionLayout />;
};
