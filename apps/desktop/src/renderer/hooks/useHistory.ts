import { useEffect, useCallback, useMemo } from "react";
import type { AppContext, HistoryEntry, HistoryState } from "../models/Context";

export interface UseHistoryResult {
	readonly history: HistoryState;
	readonly pushHistory: (entry: HistoryEntry) => void;
	readonly undo: () => void;
	readonly redo: () => void;
}

export function useHistory(bagId: string, context: AppContext): UseHistoryResult {
	const { historyStacks } = context;

	useEffect(() => {
		if (!historyStacks.has(bagId)) {
			historyStacks.set(bagId, { entries: [], cursor: 0 });
		}
	}, [bagId, historyStacks]);

	const history = useMemo<HistoryState>(() => historyStacks.get(bagId) ?? { entries: [], cursor: 0 }, [bagId, historyStacks]);

	const pushHistory = useCallback((entry: HistoryEntry): void => {
		const state = historyStacks.get(bagId);

		if (!state) return;

		state.entries.length = state.cursor;
		state.entries.push(entry);
		state.cursor = state.entries.length;
	}, [bagId, historyStacks]);

	const undo = useCallback((): void => {
		const state = historyStacks.get(bagId);

		if (!state || state.cursor <= 0) return;

		state.cursor -= 1;
		state.entries[state.cursor]?.undo();
	}, [bagId, historyStacks]);

	const redo = useCallback((): void => {
		const state = historyStacks.get(bagId);

		if (!state || state.cursor >= state.entries.length) return;

		state.entries[state.cursor]?.redo();
		state.cursor += 1;
	}, [bagId, historyStacks]);

	return { history, pushHistory, undo, redo };
}
