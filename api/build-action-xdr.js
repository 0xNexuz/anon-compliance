import { buildRegulatedActionTransaction, validateActionFields } from "./_stellar.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const { publicKey, actionFields } = request.body || {};
  if (!publicKey) {
    return response.status(400).json({ ok: false, message: "publicKey is required." });
  }

  const error = validateActionFields(actionFields || {});
  if (error) return response.status(400).json({ ok: false, message: error });

  try {
    const tx = await buildRegulatedActionTransaction(publicKey, actionFields);
    return response.status(200).json({ ok: true, xdr: tx.toXDR() });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: "Could not build regulated action transaction.",
      detail: error.message,
    });
  }
}
