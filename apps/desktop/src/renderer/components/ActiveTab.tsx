import { useImportFile } from "../hooks/useImportFile";
import type { AppContext } from "../models/Context";
import { Session } from "./Session";
import { EmptyState } from "./Session/EmptyState";

const AUDIO_FILTERS = [{ name: "Audio Files", extensions: ["wav", "mp3", "flac", "aac", "m4a", "ogg"] }];

interface ActiveTabProps {
	context: AppContext;
}

export const ActiveTab: React.FC<ActiveTabProps> = ({ context }: { context: AppContext }) => {
	const { app } = context;
	const importFile = useImportFile(context);

	const handleOpen = async (): Promise<void> => {
		const paths = await context.main.showOpenDialog({
			title: "Open Audio File",
			filters: AUDIO_FILTERS,
			properties: ["openFile"],
		});

		const filePath = paths?.[0];

		if (filePath) {
			importFile.mutate(filePath);
		}
	};

	if (importFile.isPending) {
		return (
			<div className="flex h-full items-center justify-center">
				<span className="animate-pulse text-sm text-muted-foreground">Importing audio file...</span>
			</div>
		);
	}

	const activeTab = app.tabs.find((tab) => tab.id === app.activeTabId);

	if (!activeTab) {
		return <EmptyState onOpen={() => void handleOpen()} />;
	}

	return (
		<Session
			tab={activeTab}
			context={context}
		/>
	);
};
