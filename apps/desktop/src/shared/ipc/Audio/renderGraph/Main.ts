import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TransformNode, type GraphEdge, type GraphNode } from "buffered-audio-nodes-core";
import { ReadNode, WriteNode, WaveformNode, SpectrogramNode } from "buffered-audio-nodes";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import type { ModuleRegistryMap } from "../../../models/ModuleRegistry";
import { contentHash } from "../../../utilities/contentHash";
import { RENDER_GRAPH_ACTION, type RenderGraphInput, type RenderGraphIpcParameters, type RenderGraphIpcReturn } from "./Renderer";

function topologicalSort(nodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge>): Array<GraphNode> {
	const inDegree = new Map<string, number>();
	const adjacency = new Map<string, Array<string>>();

	for (const node of nodes) {
		inDegree.set(node.id, 0);
		adjacency.set(node.id, []);
	}

	for (const edge of edges) {
		inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
		adjacency.get(edge.from)!.push(edge.to);
	}

	const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
	const result: Array<GraphNode> = [];
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	while (queue.length > 0) {
		const id = queue.shift()!;

		result.push(nodeMap.get(id)!);

		for (const neighbor of adjacency.get(id) ?? []) {
			const deg = (inDegree.get(neighbor) ?? 1) - 1;

			inDegree.set(neighbor, deg);
			if (deg === 0) queue.push(neighbor);
		}
	}

	return result;
}

function getParentNodeId(nodeId: string, edges: ReadonlyArray<GraphEdge>): string | undefined {
	const edge = edges.find((e) => e.to === nodeId);

	return edge?.from;
}

function isSourceNode(node: GraphNode, edges: ReadonlyArray<GraphEdge>): boolean {
	return !edges.some((e) => e.to === node.id);
}

function isTargetNode(node: GraphNode, edges: ReadonlyArray<GraphEdge>): boolean {
	return !edges.some((e) => e.from === node.id);
}

function computeNodeHashes(
	sortedNodes: ReadonlyArray<GraphNode>,
	edges: ReadonlyArray<GraphEdge>,
	packageVersions: Record<string, string>,
): Map<string, string> {
	const hashes = new Map<string, string>();

	for (const node of sortedNodes) {
		const parentId = getParentNodeId(node.id, edges);
		const upstreamHash = parentId ? (hashes.get(parentId) ?? "") : "";

		const hash = contentHash(
			upstreamHash,
			node.package,
			packageVersions[node.package] ?? "0.0.0",
			node.node,
			node.options ?? {},
			node.bypass ?? false,
		);

		hashes.set(node.id, hash);
	}

	return hashes;
}

function resolveSourceFilePath(node: GraphNode): string {
	const path = node.options?.path;

	if (typeof path !== "string" || path.length === 0) {
		throw new Error(`Source node "${node.id}" is missing a valid "path" option`);
	}

	return path;
}

function resolveTransform(node: GraphNode, registry: ModuleRegistryMap): TransformNode {
	const packageModules = registry.get(node.package);

	if (!packageModules) throw new Error(`Unknown package: "${node.package}"`);

	const Module = packageModules.get(node.node);

	if (!Module) throw new Error(`Unknown module: "${node.node}" in package "${node.package}"`);

	const instance = new Module(node.options);

	if (!(instance instanceof TransformNode)) throw new Error(`Module "${node.node}" is not a transform`);

	return instance;
}

function createAnalysisTargets(audioPath: string, waveformPath: string, spectrogramPath: string, binaries: Record<string, string>) {
	return {
		write: new WriteNode({ path: audioPath, bitDepth: "32f" }),
		waveform: new WaveformNode({ outputPath: waveformPath, resolution: 500 }),
		spectrogram: new SpectrogramNode({ outputPath: spectrogramPath, fftSize: 4096, hopSize: 4096, fftwAddonPath: binaries["fftw-addon"] ?? "" }),
	};
}

export class RenderGraphMainIpc extends AsyncMainIpc<RenderGraphIpcParameters, RenderGraphIpcReturn> {
	action = RENDER_GRAPH_ACTION;

	async handler(input: RenderGraphInput, dependencies: IpcHandlerDependencies): Promise<RenderGraphIpcReturn> {
		const { browserWindow, jobManager, logger, moduleRegistry } = dependencies;
		const { graphDefinition, packageVersions, userDataPath, binaries } = input;
		const { nodes, edges } = graphDefinition;

		const { id: jobId, signal } = jobManager.startJob();

		logger.info("Starting graph render", {
			namespace: "audio",
			jobId,
			nodeCount: nodes.length,
			edgeCount: edges.length,
		});

		try {
			const sortedNodes = topologicalSort(nodes, edges);
			const nodeHashes = computeNodeHashes(sortedNodes, edges, packageVersions);
			const snapshotsDir = join(userDataPath, "snapshots");

			for (const node of sortedNodes) {
				if (signal.aborted) break;

				const hash = nodeHashes.get(node.id)!;
				const snapshotDir = join(snapshotsDir, hash);

				if (node.bypass) {
					continue;
				}

				if (existsSync(snapshotDir)) {
					continue;
				}

				browserWindow.webContents.send("audio:progress", {
					jobId,
					nodeId: node.id,
					moduleIndex: 0,
					moduleName: node.node,
					framesProcessed: 0,
					sourceTotalFrames: 0,
				});

				await mkdir(snapshotDir, { recursive: true });

				const audioPath = join(snapshotDir, "audio.wav");
				const waveformPath = join(snapshotDir, "waveform.bin");
				const spectrogramPath = join(snapshotDir, "spectrogram.bin");

				const isSource = isSourceNode(node, edges);
				const isTarget = isTargetNode(node, edges);

				if (isSource) {
					const sourceFilePath = resolveSourceFilePath(node);

					const source = new ReadNode({
						path: sourceFilePath,
						ffmpegPath: binaries.ffmpeg ?? "",
						ffprobePath: binaries.ffprobe ?? "",
					});

					const targets = createAnalysisTargets(audioPath, waveformPath, spectrogramPath, binaries);

					source.to(targets.write);
					source.to(targets.waveform);
					source.to(targets.spectrogram);

					await source.render({ signal });
				} else if (isTarget) {
					const parentId = getParentNodeId(node.id, edges);
					const parentHash = parentId ? nodeHashes.get(parentId) : undefined;

					if (!parentHash) throw new Error(`Target node "${node.id}" has no parent with a computed hash`);

					const parentAudioPath = join(snapshotsDir, parentHash, "audio.wav");
					const outputPath = node.options?.path;

					if (typeof outputPath !== "string" || outputPath.length === 0) {
						throw new Error(`Target node "${node.id}" is missing a valid "path" option`);
					}

					const source = new ReadNode({
						path: parentAudioPath,
						ffmpegPath: binaries.ffmpeg ?? "",
						ffprobePath: binaries.ffprobe ?? "",
					});

					source.to(new WriteNode({ path: outputPath, bitDepth: "32f" }));

					await source.render({ signal });
				} else {
					const parentId = getParentNodeId(node.id, edges);
					const parentHash = parentId ? nodeHashes.get(parentId) : undefined;

					if (!parentHash) throw new Error(`Transform node "${node.id}" has no parent with a computed hash`);

					const parentAudioPath = join(snapshotsDir, parentHash, "audio.wav");

					const source = new ReadNode({
						path: parentAudioPath,
						ffmpegPath: binaries.ffmpeg ?? "",
						ffprobePath: binaries.ffprobe ?? "",
					});

					const transform = resolveTransform(node, moduleRegistry);

					const targets = createAnalysisTargets(audioPath, waveformPath, spectrogramPath, binaries);

					source.to(transform);
					transform.to(targets.write);
					transform.to(targets.waveform);
					transform.to(targets.spectrogram);

					await source.render({ signal });
				}

				logger.debug("Rendered node", {
					namespace: "audio",
					jobId,
					nodeId: node.id,
					hash,
				});
			}

			jobManager.completeJob(jobId);

			browserWindow.webContents.send("audio:chainComplete", {
				jobId,
				status: "completed",
				completedModules: nodes.length,
			});

			logger.info("Graph render complete", {
				namespace: "audio",
				jobId,
			});
		} catch (error) {
			jobManager.completeJob(jobId);

			if (signal.aborted) {
				browserWindow.webContents.send("audio:chainComplete", {
					jobId,
					status: "aborted",
					completedModules: 0,
				});

				logger.info("Graph render aborted", {
					namespace: "audio",
					jobId,
				});

				return jobId;
			}

			throw error;
		}

		return jobId;
	}
}
