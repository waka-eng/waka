import { geminiProviderContractFixture } from "./helpers/gemini-provider-contract-fixture.ts";
import { registerSharedProviderContractSuite } from "./helpers/shared-provider-contract-suite.ts";

registerSharedProviderContractSuite(geminiProviderContractFixture);
