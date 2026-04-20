import { App } from "aws-cdk-lib"
import { BinariesStack } from "./stacks/BinariesStack"

const app = new App()

const env = { account: "345340320424", region: "us-east-1" }

new BinariesStack(app, "Binaries", { env })
