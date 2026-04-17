import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface InstallPackageInput {
	readonly packageSpec: string;
}

export interface InstallPackageResult {
	readonly packageName: string;
	readonly packageVersion: string;
	readonly installDirectory: string;
	readonly loadEntryPath: string;
}

export type InstallPackageIpcParameters = [input: InstallPackageInput];
export type InstallPackageIpcReturn = InstallPackageResult;
export const INSTALL_PACKAGE_ACTION = "installPackage" as const;

export class InstallPackageRendererIpc extends AsyncRendererIpc<
	typeof INSTALL_PACKAGE_ACTION,
	InstallPackageIpcParameters,
	InstallPackageIpcReturn
> {
	action = INSTALL_PACKAGE_ACTION;
}
