import { openaiProviderContractFixture } from "./helpers/openai-provider-contract-fixture.ts";
import { registerSharedProviderContractSuite } from "./helpers/shared-provider-contract-suite.ts";

registerSharedProviderContractSuite(openaiProviderContractFixture);
