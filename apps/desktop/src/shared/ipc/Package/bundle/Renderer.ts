import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface BundlePackageInput {
	readonly sourceDirectory: string;
	readonly outputPath: string;
}

export type BundlePackageIpcParameters = [input: BundlePackageInput];
export type BundlePackageIpcReturn = undefined;
export const BUNDLE_PACKAGE_ACTION = "bundlePackage" as const;

export class BundlePackageRendererIpc extends AsyncRendererIpc<typeof BUNDLE_PACKAGE_ACTION, BundlePackageIpcParameters, BundlePackageIpcReturn> {
	action = BUNDLE_PACKAGE_ACTION;
}
