# AnonCompliance Circuit Spec

This is the production circuit target for replacing the current Stellar sample
Groth16 artifact.

## Private Inputs

- `kycPassed`: boolean, 1 when the user has a valid KYC credential.
- `sanctionsClear`: boolean, 1 when the user is not on a sanctions list.
- `userSecret`: private scalar used to derive a one-time nullifier.

## Public Inputs

- `policyHash`: hash of the compliance policy being enforced.
- `nullifier`: one-time public value derived from `userSecret` and `policyHash`.
- `eligible`: must equal 1.

## Constraints

```text
kycPassed * (kycPassed - 1) == 0
sanctionsClear * (sanctionsClear - 1) == 0
eligible == kycPassed * sanctionsClear
eligible == 1
nullifier == Hash(userSecret, policyHash)
```

For a Stellar-compatible production build, generate BLS12-381 Groth16 verifying
key, proof, and public inputs that match the deployed Soroban Groth16 verifier
encoding. A BN254 Circom artifact from the default snarkjs flow will not verify
against this verifier without changing the on-chain verifier implementation.
