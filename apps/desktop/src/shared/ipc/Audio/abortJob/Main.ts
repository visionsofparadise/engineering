import { abortJob } from "../../../../main/audio/jobManager";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import { ABORT_JOB_ACTION, type AbortJobIpcParameters, type AbortJobIpcReturn } from "./Renderer";

export class AbortJobMainIpc extends AsyncMainIpc<AbortJobIpcParameters, AbortJobIpcReturn> {
	action = ABORT_JOB_ACTION;

	handler(jobId: string): AbortJobIpcReturn {
		abortJob(jobId);
	}
}
