import { groth16ReturnValue, submitSignedXdr } from "./_stellar.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const { signedXdr, expected } = request.body || {};
  if (!signedXdr) {
    return response.status(400).json({ ok: false, message: "signedXdr is required." });
  }

  try {
    const result = await submitSignedXdr(signedXdr);
    const output = expected === "groth16" ? groth16ReturnValue(result) : undefined;
    return response.status(200).json({
      ok: true,
      output,
      txUrl: result.explorerUrl,
      hash: result.hash,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: "Signed transaction submission failed.",
      detail: error.message,
    });
  }
}
