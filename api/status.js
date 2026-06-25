export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    policyHash: "1111111111111111111111111111111111111111111111111111111111111111",
    verifierHash: "2222222222222222222222222222222222222222222222222222222222222222",
    hostedReadOnly: true,
  });
}
