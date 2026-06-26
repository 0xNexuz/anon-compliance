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
  actionChoice: document.querySelector("#action-choice"),
  subjectNote: document.querySelector("#subject-note"),
  kycPassed: document.querySelector("#kyc-passed"),
  sanctionsClear: document.querySelector("#sanctions-clear"),
  signingMode: document.querySelectorAll("input[name='signing-mode']"),
  connectWallet: document.querySelector("#connect-wallet"),
  walletStatus: document.querySelector("#wallet-status"),
  submitButton: document.querySelector("#proof-form button[type='submit']"),
  subjectCommitment: document.querySelector("#subject-commitment"),
  publicInputHash: document.querySelector("#public-input-hash"),
  nullifier: document.querySelector("#nullifier"),
  proofHash: document.querySelector("#proof-hash"),
  actionHash: document.querySelector("#action-hash"),
  submitResult: document.querySelector("#submit-result"),
  explorerReceipt: document.querySelector("#explorer-receipt"),
  proofTxLink: document.querySelector("#proof-tx-link"),
  attestationTxLink: document.querySelector("#attestation-tx-link"),
  actionTxLink: document.querySelector("#action-tx-link"),
  stepProof: document.querySelector("#step-proof"),
  stepAttestation: document.querySelector("#step-attestation"),
  stepAction: document.querySelector("#step-action"),
};

let currentProof = null;
let connectedWalletPublicKey = "";

hydrateConfig();
bindThemeToggle();
bindScrollAnimation();
bindScrollProgress();
await refreshStatus();
await generateProof();

els.refreshStatus.addEventListener("click", refreshStatus);
els.generateProof.addEventListener("click", generateProof);
els.connectWallet.addEventListener("click", connectWallet);
els.proofForm.addEventListener("submit", submitProof);
els.policyChoice.addEventListener("change", generateProof);
els.actionChoice.addEventListener("change", generateProof);
els.subjectNote.addEventListener("input", debounce(generateProof, 250));
els.kycPassed.addEventListener("change", generateProof);
els.sanctionsClear.addEventListener("change", generateProof);

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
    setResult("Could not refresh chain state, using local config.", "error");
  } finally {
    els.refreshStatus.disabled = false;
    els.refreshStatus.textContent = "Refresh chain state";
  }
}

async function generateProof() {
  const eligible = els.kycPassed.checked && els.sanctionsClear.checked;
  const privateCriteria = `kyc:${Number(els.kycPassed.checked)}|sanctions:${Number(
    els.sanctionsClear.checked
  )}`;
  const policyText = `${els.policyChoice.value}:${els.subjectNote.value}:${privateCriteria}`;
  const subjectCommitment = await sha256Hex(utf8(`subject:${policyText}`));
  const publicInputHash = await sha256Hex(
    utf8(`policy:${els.policyChoice.value}:eligible:${Number(eligible)}`)
  );
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
  const actionHash = await sha256Hex(
    utf8(`action:${els.actionChoice.value}:nullifier:${nullifier}:policy:${config.policyHash}`)
  );

  currentProof = {
    subjectCommitment,
    publicInputHash,
    nullifier,
    proofHash,
    actionHash,
    eligible,
  };

  renderProof(currentProof);
  els.explorerReceipt.hidden = true;
  resetLadder();
  setResult(
    eligible
      ? "Proof generated locally. Ready to submit to Stellar testnet."
      : "Proof generated, but this subject is not eligible. Turn on both private checks before submitting.",
    eligible ? "success" : "error"
  );
}

async function submitProof(event) {
  event.preventDefault();
  if (!currentProof) await generateProof();
  if (!currentProof.eligible) {
    setResult("Submission blocked locally: KYC passed and Sanctions clear must both be true.", "error");
    return;
  }

  const mode = [...els.signingMode].find((input) => input.checked)?.value || "serverless";
  setBusy(true);
  resetLadder();
  setResult(
    mode === "wallet"
      ? "Preparing wallet-signed Stellar transactions..."
      : "Submitting transaction to Stellar testnet..."
  );

  let result;
  try {
    result =
      mode === "wallet"
        ? await submitWithWallet(currentProof)
        : await submitWithHostedSigner(currentProof);
  } catch (error) {
    result = { ok: false, message: error.message };
  } finally {
    setBusy(false);
  }

  if (!result.ok) {
    setResult(`${result.message}\n${result.detail || ""}`, "error");
    return;
  }

  markStep("proof");
  markStep("attestation");
  markStep("action");
  setResult(
    `Groth16 verified: ${result.groth16Output}. Attestation accepted and regulated action unlocked on Stellar testnet.`,
    "success"
  );
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
  const publicKey = connectedWalletPublicKey || (await getWalletPublicKey(wallet));
  setWalletStatus(`Connected: ${shortKey(publicKey)}`, "success");

  const proofBuild = await postJson("/api/build-proof-xdr", { publicKey });
  if (!proofBuild.ok) return proofBuild;

  setResult("Please sign the Groth16 proof verification transaction.");
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
  markStep("proof");

  const attestationBuild = await postJson("/api/build-attestation-xdr", {
    publicKey,
    proofFields: proof,
  });
  if (!attestationBuild.ok) return attestationBuild;

  setResult("Please sign the compliance attestation transaction.");
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
  markStep("attestation");

  const actionBuild = await postJson("/api/build-action-xdr", {
    publicKey,
    actionFields: {
      nullifier: proof.nullifier,
      actionHash: proof.actionHash,
    },
  });
  if (!actionBuild.ok) return actionBuild;

  setResult("Please sign the regulated action unlock transaction.");
  const signedActionXdr = await signWalletTransaction(wallet, actionBuild.xdr, publicKey);
  const actionSubmit = await postJson("/api/submit-signed", {
    signedXdr: signedActionXdr,
    expected: "action",
  });
  if (!actionSubmit.ok) return actionSubmit;
  markStep("action");

  return {
    ok: true,
    signerMode: "wallet",
    groth16Verified: true,
    groth16Output: true,
    groth16TxUrl: proofSubmit.txUrl,
    txUrl: attestationSubmit.txUrl,
    actionTxUrl: actionSubmit.txUrl,
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
  const candidates = [window.freighterApi, window.freighterApi?.default, window.freighter];
  const wallet = candidates.find(hasWalletMethods);
  return wallet || createFreighterBridge();
}

async function connectWallet() {
  els.connectWallet.disabled = true;
  setWalletStatus("Connecting to Freighter...");

  try {
    const wallet = getWalletApi();
    const publicKey = await getWalletPublicKey(wallet);
    connectedWalletPublicKey = publicKey;
    setWalletStatus(`Connected: ${shortKey(publicKey)}`, "success");
  } catch (error) {
    setWalletStatus(error.message, "error");
  } finally {
    els.connectWallet.disabled = false;
  }
}

async function getWalletPublicKey(wallet) {
  if (wallet.isConnected) {
    const connected = await wallet.isConnected();
    const isConnected =
      typeof connected === "boolean" ? connected : connected?.isConnected ?? !connected?.error;
    if (!isConnected) {
      throw new Error(extractWalletError(connected) || "Freighter is installed but not connected.");
    }
  }

  if (wallet.isAllowed) {
    const allowed = await wallet.isAllowed();
    const isAllowed = typeof allowed === "boolean" ? allowed : allowed?.isAllowed;
    if (!isAllowed && wallet.setAllowed) {
      const grant = await wallet.setAllowed();
      const grantError = extractWalletError(grant);
      if (grantError) throw new Error(grantError);
    }
    if (!isAllowed && wallet.requestAccess) {
      const access = await wallet.requestAccess();
      const accessAddress = readWalletAddress(access);
      if (accessAddress) return accessAddress;
      const accessError = extractWalletError(access);
      if (accessError) throw new Error(accessError);
    }
  }

  if (wallet.getAddress) {
    const value = await wallet.getAddress();
    const address = readWalletAddress(value);
    if (address) return address;
    const addressError = extractWalletError(value);
    if (addressError) throw new Error(addressError);
  }

  if (wallet.getPublicKey) {
    const value = await wallet.getPublicKey();
    const address = readWalletAddress(value);
    if (address) return address;
    const keyError = extractWalletError(value);
    if (keyError) throw new Error(keyError);
  }

  if (wallet.requestAccess) {
    const access = await wallet.requestAccess();
    const address = readWalletAddress(access);
    if (address) return address;
    const accessError = extractWalletError(access);
    if (accessError) throw new Error(accessError);
  }

  throw new Error("Freighter did not return a public key. Unlock the wallet and approve site access.");
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
    const signedXdr =
      typeof signed === "string" ? signed : signed?.signedTxXdr || signed?.xdr || signed?.result;
    if (signedXdr) return signedXdr;
    throw new Error(extractWalletError(signed) || "Freighter did not return a signed transaction.");
  }

  throw new Error("Wallet does not expose signTransaction.");
}

function readWalletAddress(value) {
  if (typeof value === "string") return value;
  return value?.address || value?.publicKey || value?.accountId || "";
}

function extractWalletError(value) {
  if (!value) return "";
  if (typeof value === "string") return "";
  if (typeof value.error === "string") return value.error;
  return value.error?.message || value.message || "";
}

function setWalletStatus(message, state = "") {
  els.walletStatus.textContent = message;
  els.walletStatus.classList.toggle("success", state === "success");
  els.walletStatus.classList.toggle("error", state === "error");
}

function shortKey(publicKey) {
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`;
}

function hasWalletMethods(wallet) {
  return (
    wallet &&
    typeof wallet === "object" &&
    (wallet.signTransaction || wallet.getAddress || wallet.requestAccess || wallet.isConnected)
  );
}

function createFreighterBridge() {
  return {
    async isConnected() {
      const response = await freighterRequest("REQUEST_CONNECTION_STATUS");
      return {
        isConnected: Boolean(response.isConnected),
        error: response.apiError,
      };
    },
    async isAllowed() {
      const response = await freighterRequest("REQUEST_ALLOWED_STATUS");
      return {
        isAllowed: Boolean(response.isAllowed),
        error: response.apiError,
      };
    },
    async setAllowed() {
      const response = await freighterRequest("SET_ALLOWED_STATUS", {}, 30000);
      return {
        isAllowed: Boolean(response.isAllowed),
        error: response.apiError,
      };
    },
    async requestAccess() {
      const response = await freighterRequest("REQUEST_ACCESS", {}, 30000);
      return {
        address: response.publicKey || response.address || "",
        publicKey: response.publicKey || response.address || "",
        error: response.apiError,
      };
    },
    async getAddress() {
      const response = await freighterRequest("REQUEST_PUBLIC_KEY");
      return {
        address: response.publicKey || response.address || "",
        publicKey: response.publicKey || response.address || "",
        error: response.apiError,
      };
    },
    async signTransaction(transactionXdr, options) {
      const response = await freighterRequest(
        "SUBMIT_TRANSACTION",
        {
          transactionXdr,
          networkPassphrase: options?.networkPassphrase,
          accountToSign: options?.address || options?.accountToSign,
        },
        60000
      );
      return {
        signedTxXdr: response.signedTransaction || response.signedTxXdr || "",
        signerAddress: response.signerAddress || "",
        error: response.apiError,
      };
    },
  };
}

function freighterRequest(type, payload = {}, timeoutMs = 5000) {
  const messageId = Date.now() + Math.random();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({
        apiError: {
          message:
            "Freighter did not respond to this page. Make sure the extension is enabled for this browser profile, unlock it, refresh the page, and approve site access.",
        },
      });
    }, timeoutMs);

    function onMessage(event) {
      const data = event.data || {};
      const responseId = data.messageId ?? data.messagedId;
      if (
        event.source === window &&
        data.source === "FREIGHTER_EXTERNAL_MSG_RESPONSE" &&
        responseId === messageId
      ) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(data);
      }
    }

    window.addEventListener("message", onMessage, false);
    window.postMessage(
      {
        source: "FREIGHTER_EXTERNAL_MSG_REQUEST",
        messageId,
        type,
        ...payload,
      },
      window.location.origin
    );
  });
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

  if (result.actionTxUrl) {
    els.actionTxLink.href = result.actionTxUrl;
    els.actionTxLink.textContent = "Regulated action unlock tx";
    els.actionTxLink.hidden = false;
  } else {
    els.actionTxLink.hidden = true;
  }

  els.explorerReceipt.hidden = !result.groth16TxUrl && !result.txUrl && !result.actionTxUrl;
}

function renderProof(proof) {
  els.subjectCommitment.textContent = proof.subjectCommitment;
  els.publicInputHash.textContent = proof.publicInputHash;
  els.nullifier.textContent = proof.nullifier;
  els.proofHash.textContent = proof.proofHash;
  els.actionHash.textContent = proof.actionHash;
}

function setBusy(isBusy) {
  els.submitButton.disabled = isBusy;
  els.generateProof.disabled = isBusy;
  els.submitButton.textContent = isBusy ? "Working on testnet..." : "Submit to testnet";
}

function setResult(message, state = "") {
  els.submitResult.textContent = message.trim();
  els.submitResult.classList.toggle("success", state === "success");
  els.submitResult.classList.toggle("error", state === "error");
}

function resetLadder() {
  [els.stepProof, els.stepAttestation, els.stepAction].forEach((step) => {
    step.classList.remove("is-done");
  });
}

function markStep(stepName) {
  const map = {
    proof: els.stepProof,
    attestation: els.stepAttestation,
    action: els.stepAction,
  };
  map[stepName]?.classList.add("is-done");
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

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
