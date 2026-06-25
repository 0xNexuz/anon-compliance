import {
  buildComplianceTransaction,
  buildGroth16Transaction,
  groth16ReturnValue,
  signAndSubmit,
  validateProofFields,
} from "./_stellar.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  if (!process.env.STELLAR_SECRET_KEY) {
    return response.status(501).json({
      ok: false,
      message: "Serverless signer is not configured.",
      detail:
        "Set STELLAR_SECRET_KEY in Vercel or use wallet signing from the frontend.",
    });
  }

  const error = validateProofFields(request.body || {});
  if (error) return response.status(400).json({ ok: false, message: error });

  try {
    const publicKey = (await import("@stellar/stellar-sdk")).Keypair.fromSecret(
      process.env.STELLAR_SECRET_KEY
    ).publicKey();

    const groth16Tx = await buildGroth16Transaction(publicKey);
    const groth16Result = await signAndSubmit(groth16Tx, process.env.STELLAR_SECRET_KEY);
    const groth16Output = groth16ReturnValue(groth16Result);

    if (groth16Output !== true) {
      return response.status(422).json({
        ok: false,
        message: "Groth16 verifier rejected the proof.",
        groth16TxUrl: groth16Result.explorerUrl,
        groth16Output,
      });
    }

    const complianceTx = await buildComplianceTransaction(publicKey, request.body);
    const complianceResult = await signAndSubmit(
      complianceTx,
      process.env.STELLAR_SECRET_KEY
    );

    return response.status(200).json({
      ok: true,
      signerMode: "serverless",
      groth16Verified: true,
      groth16Output,
      groth16TxUrl: groth16Result.explorerUrl,
      txUrl: complianceResult.explorerUrl,
      nullifier: request.body.nullifier,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: "Serverless submission failed.",
      detail: error.message,
    });
  }
}
