import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = join(process.cwd(), "frontend");
const STELLAR_EXE =
  process.env.STELLAR_EXE || "C:\\Program Files (x86)\\Stellar CLI\\stellar.exe";
const CONTRACT_ID =
  process.env.CONTRACT_ID ||
  "CCNCJ7KJTRPLPBV4VZNX22JKXFHUCKGCCUUQSD6GYENMMVX32YD4JB2E";
const GROTH16_CONTRACT_ID =
  process.env.GROTH16_CONTRACT_ID ||
  "CDL5QA45XIHBWNHMYHSVZTUMS4SIDKKUFLJAOTILU55R6HDC22SDFAC5";
const SOURCE_ACCOUNT = process.env.STELLAR_SOURCE || "anoncompliance";
const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const POLICY_HASH =
  process.env.POLICY_HASH ||
  "1111111111111111111111111111111111111111111111111111111111111111";
const VERIFIER_HASH =
  process.env.VERIFIER_HASH ||
  "2222222222222222222222222222222222222222222222222222222222222222";
const GROTH16_VK_PATH =
  process.env.GROTH16_VK_PATH || "work\\zk-export\\out\\vk.json";
const GROTH16_PROOF_PATH =
  process.env.GROTH16_PROOF_PATH || "work\\zk-export\\out\\proof.json";
const GROTH16_PUBLIC_PATH =
  process.env.GROTH16_PUBLIC_PATH || "work\\zk-export\\out\\public.json";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function isHex32(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

async function sourceAddress() {
  const { stdout } = await execFileAsync(
    STELLAR_EXE,
    ["keys", "public-key", SOURCE_ACCOUNT],
    { timeout: 30000, windowsHide: true }
  );
  return stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStellarError(error) {
  const text = `${error.stderr || ""}\n${error.stdout || ""}\n${error.message || ""}`;
  return /client error \(Connect\)|client error \(SendRequest\)|ECONNRESET|ETIMEDOUT|timed out|network/i.test(text);
}

async function withStellarRetry(label, fn) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await fn();
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!isTransientStellarError(error) || attempt === 3) {
        break;
      }

      await sleep(900 * attempt);
    }
  }

  lastError.message = `${label} failed after retry: ${lastError.message}`;
  throw lastError;
}

async function invokeContract(args) {
  return withStellarRetry("Compliance contract call", async () => {
    const { stdout, stderr } = await execFileAsync(
      STELLAR_EXE,
      [
        "contract",
        "invoke",
        "--id",
        CONTRACT_ID,
        "--source-account",
        SOURCE_ACCOUNT,
        "--network",
        NETWORK,
        "--",
        ...args,
      ],
      { timeout: 120000, windowsHide: true }
    );

    return { stdout, stderr };
  });
}

async function invokeGroth16Verifier() {
  return withStellarRetry("Groth16 verifier call", async () => {
    const { stdout, stderr } = await execFileAsync(
      STELLAR_EXE,
      [
        "contract",
        "invoke",
        "--id",
        GROTH16_CONTRACT_ID,
        "--source-account",
        SOURCE_ACCOUNT,
        "--network",
        NETWORK,
        "--send",
        "yes",
        "--",
        "verify_proof",
        "--vk-file-path",
        GROTH16_VK_PATH,
        "--proof-file-path",
        GROTH16_PROOF_PATH,
        "--pub_signals-file-path",
        GROTH16_PUBLIC_PATH,
      ],
      { timeout: 180000, windowsHide: true }
    );

    const txMatch = stderr.match(/https:\/\/stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]+/);
    return {
      stdout,
      stderr,
      verified: stdout.trim() === "true",
      txUrl: txMatch ? txMatch[0] : null,
    };
  });
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/config") {
    return json(res, 200, {
      contractId: CONTRACT_ID,
      groth16ContractId: GROTH16_CONTRACT_ID,
      network: NETWORK,
      sourceAccount: SOURCE_ACCOUNT,
      policyHash: POLICY_HASH,
      verifierHash: VERIFIER_HASH,
      labUrl: `https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`,
      groth16LabUrl: `https://lab.stellar.org/r/testnet/contract/${GROTH16_CONTRACT_ID}`,
    });
  }

  if (req.method === "GET" && req.url === "/api/status") {
    try {
      const policy = await invokeContract(["policy_hash"]);
      const verifier = await invokeContract(["verifier_hash"]);
      return json(res, 200, {
        ok: true,
        policyHash: policy.stdout.trim(),
        verifierHash: verifier.stdout.trim(),
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        message: "Unable to read contract state.",
        detail: error.stderr || error.message,
      });
    }
  }

  if (req.method === "POST" && req.url === "/api/submit") {
    try {
      const body = await readBody(req);
      const fields = [
        "subjectCommitment",
        "publicInputHash",
        "nullifier",
        "proofHash",
      ];

      for (const field of fields) {
        if (!isHex32(body[field])) {
          return json(res, 400, { ok: false, message: `${field} must be 32 bytes of hex.` });
        }
      }
      if (!isHex32(body.actionHash)) {
        return json(res, 400, { ok: false, message: "actionHash must be 32 bytes of hex." });
      }

      const groth16 = await invokeGroth16Verifier();
      if (!groth16.verified) {
        return json(res, 422, {
          ok: false,
          message: "Groth16 verifier rejected the proof.",
          detail: groth16.stderr,
        });
      }

      const result = await invokeContract([
        "submit_compliance",
        "--subject_commitment",
        body.subjectCommitment,
        "--public_input_hash",
        body.publicInputHash,
        "--nullifier",
        body.nullifier,
        "--proof_hash",
        body.proofHash,
      ]);

      const txMatch = result.stderr.match(/https:\/\/stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]+/);
      const actor = await sourceAddress();
      const action = await invokeContract([
        "execute_action",
        "--actor",
        actor,
        "--nullifier",
        body.nullifier,
        "--action_hash",
        body.actionHash,
      ]);

      const actionTxMatch = action.stderr.match(/https:\/\/stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]+/);
      return json(res, 200, {
        ok: true,
        groth16Verified: true,
        groth16Output: groth16.stdout.trim(),
        groth16TxUrl: groth16.txUrl,
        groth16Attempts: groth16.attempts,
        submitAttempts: result.attempts,
        actionAttempts: action.attempts,
        stdout: result.stdout.trim(),
        logs: `${result.stderr.trim()}\n${action.stderr.trim()}`.trim(),
        txUrl: txMatch ? txMatch[0] : null,
        actionTxUrl: actionTxMatch ? actionTxMatch[0] : null,
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        message: "Contract submission failed.",
        detail: error.stderr || error.message,
      });
    }
  }

  return json(res, 404, { ok: false, message: "Unknown API route." });
}

async function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = normalize(decodeURIComponent(rawPath))
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    json(res, 500, { ok: false, message: error.message });
  }
}).listen(PORT, () => {
  console.log(`AnonCompliance frontend running at http://localhost:${PORT}`);
});
