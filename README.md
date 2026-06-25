# AnonCompliance

AnonCompliance is a Stellar smart-contract demo for privacy-preserving compliance gates.

The product idea is simple: a user proves off-chain that they satisfy a policy
such as "KYC passed", "not sanctioned", "country is allowed", or "transfer is
below a private limit". The Stellar contract only sees a proof result and public
commitments, then allows the compliant action without exposing the user's raw
identity data.

## Hackathon fit

- Uses Stellar smart contracts as the on-chain enforcement layer.
- Makes ZK load-bearing: compliance is checked through proof verification before
  an action is accepted.
- Targets real-world Stellar use cases: stablecoin payments, tokenized assets,
  institutional settlement, and regulated transfers.

## MVP architecture

```text
Issuer/KYC provider
    |
    | private credential
    v
User wallet/prover ---- ZK proof ----> AnonCompliance Soroban contract
                                            |
                                            | verifies proof/nullifier
                                            v
                                    compliant action allowed
```

This repo currently contains the Stellar contract shell and a deterministic demo
verifier adapter. For the final hackathon build, replace the adapter with one of:

- Noir verifier contract integration
- Circom/Groth16 verifier based on Stellar's verifier examples
- RISC Zero verifier flow for more general computation proofs

## Contract behavior

The contract stores:

- `admin`: contract administrator
- `policy_hash`: hash of the current compliance policy
- `verifier_hash`: identifier/commitment for the verifier circuit
- used `nullifier`s to prevent replay

Users call `submit_compliance` with:

- `subject_commitment`: commitment to the user's private identity/credential
- `public_input_hash`: hash of public proof inputs
- `nullifier`: one-time value derived in the ZK circuit
- `proof_hash`: demo proof commitment

If verification passes and the nullifier was not used, the contract records the
attestation and emits an event.

## Testnet

Yes, this can run on Stellar testnet. The local machine has Rust installed, but
the Stellar CLI is not installed yet.

Install Stellar CLI:

```powershell
cargo install --locked stellar-cli
```

Add the WASM target:

```powershell
rustup target add wasm32-unknown-unknown
```

Build:

```powershell
cargo build --target wasm32-unknown-unknown --release
```

Configure testnet identity and network:

```powershell
stellar keys generate anoncompliance --network testnet
stellar contract deploy `
  --wasm target\wasm32-unknown-unknown\release\anon_compliance.wasm `
  --source anoncompliance `
  --network testnet
```

After deployment, initialize the contract with an admin address, a policy hash,
and a verifier hash. Then submit a proof/nullifier pair.

Current testnet deployment:

- Contract: `CBNKFAG67RWIW3DJTVDQUHRVS44KKDDBOJ52XH64ZTHP5R57TOYKUQNN`
- Policy hash: `1111111111111111111111111111111111111111111111111111111111111111`
- Verifier hash: `2222222222222222222222222222222222222222222222222222222222222222`
- Stellar Lab: <https://lab.stellar.org/r/testnet/contract/CBNKFAG67RWIW3DJTVDQUHRVS44KKDDBOJ52XH64ZTHP5R57TOYKUQNN>

## Frontend demo

Run the local web demo:

```powershell
npm start
```

Open:

```text
http://localhost:4173
```

The frontend includes:

- a six-section landing/product flow with scroll reveal animation
- live contract config/status reads
- client-side demo proof generation
- a backend submit endpoint that first calls the deployed Groth16 verifier
  contract, then invokes the Stellar testnet compliance contract with the local
  `anoncompliance` testnet identity

The backend expects Stellar CLI at:

```text
C:\Program Files (x86)\Stellar CLI\stellar.exe
```

Override it with `STELLAR_EXE` if needed.

## Hosted deployment

The Vercel deployment is configured as a public read-only frontend. It shows the
contracts, docs, explorer links, and UI flow. Live proof/attestation submission
uses the local backend because it depends on Stellar CLI plus the local
`anoncompliance` testnet identity.

For hosted transaction submission, replace the CLI-based backend with a
serverless Stellar SDK signer or a wallet-signing flow.

Current Groth16 verifier deployment:

- Contract: `CDL5QA45XIHBWNHMYHSVZTUMS4SIDKKUFLJAOTILU55R6HDC22SDFAC5`
- Stellar Lab: <https://lab.stellar.org/r/testnet/contract/CDL5QA45XIHBWNHMYHSVZTUMS4SIDKKUFLJAOTILU55R6HDC22SDFAC5>
- Proof artifacts: `work/zk-export/out`

Important: the Groth16 proof is real and verified by a deployed Soroban
verifier, but the current circuit is Stellar's sample private multiplication
circuit. The remaining product step is replacing that sample circuit with an
AnonCompliance-specific circuit for KYC/sanctions/eligibility claims.

## Next build steps

1. Replace the demo verifier adapter with a real Noir or Circom verifier.
2. Add a simple web prover/demo UI.
3. Gate a mock regulated transfer or tokenized RWA action behind the compliance
   attestation.
4. Record a 2-3 minute demo showing the proof generated off-chain and verified
   on Stellar testnet.
