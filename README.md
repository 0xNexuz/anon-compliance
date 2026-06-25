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

This repo contains a Stellar contract, hosted frontend, serverless API routes,
wallet-signing XDR flow, and a deployed Groth16 verifier call. The remaining
cryptographic production step is replacing the embedded sample verifier artifact
with the AnonCompliance circuit described in `zk/compliance-circuit-spec.md`.

- BLS12-381 Groth16 artifacts compatible with the Stellar verifier example
- Noir verifier contract integration
- RISC Zero verifier flow for more general computation proofs

## Contract behavior

The contract stores:

- `admin`: contract administrator
- `policy_hash`: hash of the current compliance policy
- `verifier_hash`: identifier/commitment for the verifier circuit
- used `nullifier`s to prevent replay
- `attestation`s keyed by nullifier
- one executed regulated `action` per nullifier

Users call `submit_compliance` with:

- `subject_commitment`: commitment to the user's private identity/credential
- `public_input_hash`: hash of public proof inputs
- `nullifier`: one-time value derived in the ZK circuit
- `proof_hash`: demo proof commitment

If verification passes and the nullifier was not used, the contract records the
attestation and emits an event.

After attestation, users call `execute_action` with:

- `actor`: wallet authorizing the regulated action
- `nullifier`: the already-attested nullifier
- `action_hash`: hash of the action being unlocked, such as compliant transfer,
  RWA subscription, or settlement release

The contract rejects action execution if no attestation exists, and it prevents
the same nullifier from unlocking more than one action.

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

- Contract: `CCNCJ7KJTRPLPBV4VZNX22JKXFHUCKGCCUUQSD6GYENMMVX32YD4JB2E`
- Policy hash: `1111111111111111111111111111111111111111111111111111111111111111`
- Verifier hash: `2222222222222222222222222222222222222222222222222222222222222222`
- Stellar Lab: <https://lab.stellar.org/r/testnet/contract/CCNCJ7KJTRPLPBV4VZNX22JKXFHUCKGCCUUQSD6GYENMMVX32YD4JB2E>

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
- hosted-signer submission that first calls the deployed Groth16 verifier
  contract, then invokes the Stellar testnet compliance contract and action gate
- wallet-signing endpoints that build XDR for Freighter-style wallets
- explorer links for proof verification, compliance attestation, and regulated
  action unlock transactions

The local backend expects Stellar CLI at:

```text
C:\Program Files (x86)\Stellar CLI\stellar.exe
```

Override it with `STELLAR_EXE` if needed.

## Hosted deployment

The Vercel deployment supports real Stellar testnet submission in two modes:

- Hosted signer: Vercel signs with `STELLAR_SECRET_KEY` from environment
  variables.
- Wallet signing: the API builds unsigned XDR and the user signs in a Stellar
  wallet.

Current Groth16 verifier deployment:

- Contract: `CDL5QA45XIHBWNHMYHSVZTUMS4SIDKKUFLJAOTILU55R6HDC22SDFAC5`
- Stellar Lab: <https://lab.stellar.org/r/testnet/contract/CDL5QA45XIHBWNHMYHSVZTUMS4SIDKKUFLJAOTILU55R6HDC22SDFAC5>
- Proof artifacts: `work/zk-export/out`

Important: the Groth16 verifier call and Stellar transactions are real testnet
actions, but the current verifier artifact is Stellar's sample private
multiplication circuit. The production circuit target is documented in
`zk/compliance-circuit-spec.md`: private `kycPassed`, `sanctionsClear`, and
`userSecret` inputs with public `policyHash`, `nullifier`, and `eligible = 1`.
Do not call the cryptography production-ready until that artifact has been
generated, tested, and deployed.

## Next build steps

1. Generate Stellar-compatible BLS12-381 Groth16 artifacts for the compliance
   circuit spec.
2. Add a browser or backend prover that produces proof data from private inputs.
3. Replace the hosted demo signer with a production custody model or require
   wallet signing only.
4. Record a 2-3 minute demo showing the proof generated off-chain and verified
   on Stellar testnet.
