const config = await fetchJson("/api/config");

const els = {
  labLink: document.querySelector("#lab-link"),
  footerContractLink: document.querySelector("#footer-contract-link"),
  network: document.querySelector("#network"),
  contractId: document.querySelector("#contract-id"),
  groth16Id: document.querySelector("#groth16-id"),
  policyHash: document.querySelector("#policy-hash"),
  verifierHash: document.querySelector("#verifier-hash"),
  refreshStatus: document.querySelector("#refresh-status"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeLabel: document.querySelector("#theme-label"),
  generateProof: document.querySelector("#generate-proof"),
  proofForm: document.querySelector("#proof-form"),
  policyChoice: document.querySelector("#policy-choice"),
  subjectNote: document.querySelector("#subject-note"),
  signingMode: document.querySelectorAll("input[name='signing-mode']"),
  subjectCommitment: document.querySelector("#subject-commitment"),
  publicInputHash: document.querySelector("#public-input-hash"),
  nullifier: document.querySelector("#nullifier"),
  proofHash: document.querySelector("#proof-hash"),
  submitResult: document.querySelector("#submit-result"),
  explorerReceipt: document.querySelector("#explorer-receipt"),
  proofTxLink: document.querySelector("#proof-tx-link"),
  attestationTxLink: document.querySelector("#attestation-tx-link"),
};

let currentProof = null;

hydrateConfig();
bindThemeToggle();
bindScrollAnimation();
bindScrollProgress();
await refreshStatus();
await generateProof();

els.refreshStatus.addEventListener("click", refreshStatus);
els.generateProof.addEventListener("click", generateProof);
els.proofForm.addEventListener("submit", submitProof);

function bindThemeToggle() {
  const storedTheme = localStorage.getItem("anoncompliance-theme");
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(storedTheme || (prefersDark ? "dark" : "light"));

  els.themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("anoncompliance-theme", nextTheme);
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
}

function hydrateConfig() {
  els.labLink.href = config.labUrl;
  els.footerContractLink.href = config.labUrl;
  els.network.textContent = config.network;
  els.contractId.textContent = config.contractId;
  els.groth16Id.textContent = config.groth16ContractId;
  els.policyHash.textContent = config.policyHash;
  els.verifierHash.textContent = config.verifierHash;
}

function bindScrollAnimation() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add("is-visible");
      }
    },
    { threshold: 0.18 }
  );

  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

function bindScrollProgress() {
  const root = document.documentElement;
  const update = () => {
    const max = root.scrollHeight - window.innerHeight;
    const progress = max > 0 ? window.scrollY / max : 0;
    root.style.setProperty("--scroll-progress", String(Math.min(1, Math.max(0, progress))));
    root.style.setProperty("--parallax", String(progress));
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
}

async function refreshStatus() {
  els.refreshStatus.disabled = true;
  els.refreshStatus.textContent = "Reading chain state...";

  try {
    const status = await fetchJson("/api/status");
    if (status.ok) {
      els.policyHash.textContent = cleanCliBytes(status.policyHash) || config.policyHash;
      els.verifierHash.textContent = cleanCliBytes(status.verifierHash) || config.verifierHash;
    }
  } catch {
    els.submitResult.textContent = "Could not refresh chain state, using local config.";
  } finally {
    els.refreshStatus.disabled = false;
    els.refreshStatus.textContent = "Refresh chain state";
  }
}

async function generateProof() {
  const policyText = `${els.policyChoice.value}:${els.subjectNote.value}`;
  const subjectCommitment = await sha256Hex(utf8(`subject:${policyText}`));
  const publicInputHash = await sha256Hex(utf8(`policy:${els.policyChoice.value}`));
  const nullifier = await sha256Hex(crypto.getRandomValues(new Uint8Array(32)));

  const proofHash = await sha256Hex(
    concatHex([
      subjectCommitment,
      publicInputHash,
      nullifier,
      config.policyHash,
      config.verifierHash,
    ])
  );

  currentProof = {
    subjectCommitment,
    publicInputHash,
    nullifier,
    proofHash,
  };

  renderProof(currentProof);
  els.explorerReceipt.hidden = true;
  els.submitResult.textContent = "Proof generated locally. Ready to submit to Stellar testnet.";
}

async function submitProof(event) {
  event.preventDefault();
  if (!currentProof) await generateProof();

  const mode = [...els.signingMode].find((input) => input.checked)?.value || "serverless";
  els.submitResult.textContent =
    mode === "wallet"
      ? "Preparing wallet-signed Stellar transactions..."
      : "Submitting transaction to Stellar testnet...";

  let result;
  try {
    result =
      mode === "wallet"
        ? await submitWithWallet(currentProof)
        : await submitWithHostedSigner(currentProof);
  } catch (error) {
    result = { ok: false, message: error.message };
  }

  if (!result.ok) {
    els.submitResult.textContent = `${result.message}\n${result.detail || ""}`;
    return;
  }

  els.submitResult.innerHTML = `Groth16 verified: ${result.groth16Output}. Attestation accepted on testnet.`;
  renderExplorerReceipt(result);
}

async function submitWithHostedSigner(proof) {
  const response = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proof),
  });

  return response.json();
}

async function submitWithWallet(proof) {
  const wallet = getWalletApi();
  const publicKey = await getWalletPublicKey(wallet);

  const proofBuild = await postJson("/api/build-proof-xdr", { publicKey });
  if (!proofBuild.ok) return proofBuild;

  els.submitResult.textContent = "Please sign the Groth16 proof verification transaction.";
  const signedProofXdr = await signWalletTransaction(wallet, proofBuild.xdr, publicKey);
  const proofSubmit = await postJson("/api/submit-signed", {
    signedXdr: signedProofXdr,
    expected: "groth16",
  });
  if (!proofSubmit.ok) return proofSubmit;
  if (proofSubmit.output !== true) {
    return {
      ok: false,
      message: "Groth16 verifier rejected the wallet-signed proof transaction.",
    };
  }

  const attestationBuild = await postJson("/api/build-attestation-xdr", {
    publicKey,
    proofFields: proof,
  });
  if (!attestationBuild.ok) return attestationBuild;

  els.submitResult.textContent = "Please sign the compliance attestation transaction.";
  const signedAttestationXdr = await signWalletTransaction(
    wallet,
    attestationBuild.xdr,
    publicKey
  );
  const attestationSubmit = await postJson("/api/submit-signed", {
    signedXdr: signedAttestationXdr,
    expected: "attestation",
  });
  if (!attestationSubmit.ok) return attestationSubmit;

  return {
    ok: true,
    signerMode: "wallet",
    groth16Verified: true,
    groth16Output: true,
    groth16TxUrl: proofSubmit.txUrl,
    txUrl: attestationSubmit.txUrl,
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function getWalletApi() {
  const wallet = window.freighterApi || window.freighter;
  if (!wallet) {
    throw new Error("Freighter wallet was not found. Install Freighter or use Hosted signer.");
  }
  return wallet;
}

async function getWalletPublicKey(wallet) {
  if (wallet.requestAccess) {
    const access = await wallet.requestAccess();
    return typeof access === "string" ? access : access.address || access.publicKey;
  }
  if (wallet.getPublicKey) {
    const value = await wallet.getPublicKey();
    return typeof value === "string" ? value : value.address || value.publicKey;
  }
  throw new Error("Wallet does not expose a public key method.");
}

async function signWalletTransaction(wallet, xdr, publicKey) {
  const options = {
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    accountToSign: publicKey,
    address: publicKey,
  };

  if (wallet.signTransaction) {
    const signed = await wallet.signTransaction(xdr, options);
    return typeof signed === "string" ? signed : signed.signedTxXdr || signed.xdr;
  }

  throw new Error("Wallet does not expose signTransaction.");
}

function renderExplorerReceipt(result) {
  if (result.groth16TxUrl) {
    els.proofTxLink.href = result.groth16TxUrl;
    els.proofTxLink.textContent = "Proof verification tx";
    els.proofTxLink.hidden = false;
  } else {
    els.proofTxLink.hidden = true;
  }

  if (result.txUrl) {
    els.attestationTxLink.href = result.txUrl;
    els.attestationTxLink.textContent = "Compliance attestation tx";
    els.attestationTxLink.hidden = false;
  } else {
    els.attestationTxLink.hidden = true;
  }

  els.explorerReceipt.hidden = !result.groth16TxUrl && !result.txUrl;
}

function renderProof(proof) {
  els.subjectCommitment.textContent = proof.subjectCommitment;
  els.publicInputHash.textContent = proof.publicInputHash;
  els.nullifier.textContent = proof.nullifier;
  els.proofHash.textContent = proof.proofHash;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(hash));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concatHex(parts) {
  const output = new Uint8Array(parts.length * 32);
  parts.forEach((part, index) => output.set(hexToBytes(part), index * 32));
  return output;
}

function cleanCliBytes(value) {
  const match = String(value).match(/[0-9a-fA-F]{64}/);
  return match ? match[0] : "";
}
