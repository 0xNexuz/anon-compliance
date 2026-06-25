import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  GROTH16_PROOF,
  GROTH16_PUBLIC_SIGNALS,
  GROTH16_VK,
} from "./zk-artifacts.js";

export const CONTRACT_ID =
  process.env.CONTRACT_ID ||
  "CBNKFAG67RWIW3DJTVDQUHRVS44KKDDBOJ52XH64ZTHP5R57TOYKUQNN";
export const GROTH16_CONTRACT_ID =
  process.env.GROTH16_CONTRACT_ID ||
  "CDL5QA45XIHBWNHMYHSVZTUMS4SIDKKUFLJAOTILU55R6HDC22SDFAC5";
export const POLICY_HASH =
  process.env.POLICY_HASH ||
  "1111111111111111111111111111111111111111111111111111111111111111";
export const VERIFIER_HASH =
  process.env.VERIFIER_HASH ||
  "2222222222222222222222222222222222222222222222222222222222222222";
export const RPC_URL =
  process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

export function isHex32(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

export function server() {
  return new rpc.Server(RPC_URL);
}

function bytes(hex) {
  return xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
}

function symbol(value) {
  return xdr.ScVal.scvSymbol(value);
}

function struct(object) {
  return xdr.ScVal.scvMap(
    Object.entries(object).map(
      ([key, val]) => new xdr.ScMapEntry({ key: symbol(key), val })
    )
  );
}

function vec(items) {
  return xdr.ScVal.scvVec(items);
}

export function loadGroth16Args() {
  const vk = GROTH16_VK;
  const proof = GROTH16_PROOF;
  const pubSignals = GROTH16_PUBLIC_SIGNALS;

  return {
    vk: struct({
      alpha: bytes(vk.alpha),
      beta: bytes(vk.beta),
      delta: bytes(vk.delta),
      gamma: bytes(vk.gamma),
      ic: vec(vk.ic.map(bytes)),
    }),
    proof: struct({
      a: bytes(proof.a),
      b: bytes(proof.b),
      c: bytes(proof.c),
    }),
    pubSignals: nativeToScVal(
      pubSignals.map((signal) => BigInt(signal)),
      { type: ["u256"] }
    ),
  };
}

export async function buildPreparedTransaction(publicKey, operation) {
  const rpcServer = server();
  const account = await rpcServer.getAccount(publicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  return rpcServer.prepareTransaction(tx);
}

export async function buildGroth16Transaction(publicKey) {
  const contract = new Contract(GROTH16_CONTRACT_ID);
  const args = loadGroth16Args();
  return buildPreparedTransaction(
    publicKey,
    contract.call("verify_proof", args.vk, args.proof, args.pubSignals)
  );
}

export async function buildComplianceTransaction(publicKey, proofFields) {
  const contract = new Contract(CONTRACT_ID);
  return buildPreparedTransaction(
    publicKey,
    contract.call(
      "submit_compliance",
      bytes(proofFields.subjectCommitment),
      bytes(proofFields.publicInputHash),
      bytes(proofFields.nullifier),
      bytes(proofFields.proofHash)
    )
  );
}

export async function signAndSubmit(preparedTx, secretKey) {
  const keypair = Keypair.fromSecret(secretKey);
  preparedTx.sign(keypair);
  return submitSignedXdr(preparedTx.toXDR());
}

export async function submitSignedXdr(signedXdr) {
  const rpcServer = server();
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sent = await rpcServer.sendTransaction(tx);
  const hash = sent.hash;

  for (let i = 0; i < 30; i += 1) {
    const result = await rpcServer.getTransaction(hash);
    if (result.status === "SUCCESS") {
      return {
        hash,
        status: result.status,
        result,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${hash}`,
      };
    }
    if (result.status === "FAILED") {
      throw new Error(`Transaction failed: ${hash}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    hash,
    status: "PENDING",
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${hash}`,
  };
}

export function groth16ReturnValue(txResult) {
  const retval = txResult?.result?.returnValue;
  if (!retval) return null;
  return scValToNative(retval);
}

export function validateProofFields(body) {
  const fields = ["subjectCommitment", "publicInputHash", "nullifier", "proofHash"];
  for (const field of fields) {
    if (!isHex32(body[field])) {
      return `${field} must be 32 bytes of hex.`;
    }
  }
  return null;
}
