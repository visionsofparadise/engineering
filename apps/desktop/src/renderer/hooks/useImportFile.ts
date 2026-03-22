import { useMutation } from "@tanstack/react-query";
import type { GraphDefinition } from "buffered-audio-nodes";
import type { AppContext } from "../models/Context";
import { addTab } from "../utils/tabs";

export function useImportFile(context: AppContext) {
	return useMutation({
		mutationFn: async (filePath: string) => {
			const { userDataPath } = context;
			const fileName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Untitled";

			const sessionsDir = `${userDataPath}/sessions`;

			await context.main.ensureDirectory(sessionsDir);

			const tempBagPath = `${sessionsDir}/${crypto.randomUUID()}.bag`;

			const graphDefinition: GraphDefinition = {
				name: fileName,
				nodes: [
					{
						id: crypto.randomUUID(),
						package: "buffered-audio-nodes",
						node: "Read",
						options: { path: filePath },
					},
				],
				edges: [],
			};

			await context.main.writeFile(tempBagPath, JSON.stringify(graphDefinition, null, 2));

			const tabId = crypto.randomUUID();

			addTab(
				{
					id: tabId,
					label: fileName,
					filePath: tempBagPath,
				},
				{ app: context.app, appStore: context.appStore },
			);

			return { tabId, filePath: tempBagPath };
		},
	});
}
