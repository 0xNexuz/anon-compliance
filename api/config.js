import {
  CONTRACT_ID,
  GROTH16_CONTRACT_ID,
  POLICY_HASH,
  VERIFIER_HASH,
} from "./_stellar.js";

export default function handler(_request, response) {
  response.status(200).json({
    contractId: CONTRACT_ID,
    groth16ContractId: GROTH16_CONTRACT_ID,
    network: "testnet",
    sourceAccount: "anoncompliance",
    policyHash: POLICY_HASH,
    verifierHash: VERIFIER_HASH,
    labUrl: `https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`,
    groth16LabUrl: `https://lab.stellar.org/r/testnet/contract/${GROTH16_CONTRACT_ID}`,
  });
}
