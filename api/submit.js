export default function handler(_request, response) {
  response.status(501).json({
    ok: false,
    message: "Hosted demo is read-only.",
    detail:
      "Run npm start locally to submit transactions. The local backend uses Stellar CLI and the anoncompliance testnet identity to send proof and attestation transactions.",
  });
}
