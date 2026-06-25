import { buildGroth16Transaction } from "./_stellar.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const { publicKey } = request.body || {};
  if (!publicKey) {
    return response.status(400).json({ ok: false, message: "publicKey is required." });
  }

  try {
    const tx = await buildGroth16Transaction(publicKey);
    return response.status(200).json({ ok: true, xdr: tx.toXDR() });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: "Could not build proof verification transaction.",
      detail: error.message,
    });
  }
}
