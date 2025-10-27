import 'dotenv/config';

const {
  X402_VERSION,
  X402_NETWORK,
  X402_ASSET,
  X402_MAX_TIMEOUT_SECONDS,
  TREASURY_ADDRESS,
  X402_PRICE_USDC
} = process.env;

const PRICE = BigInt(X402_PRICE_USDC || '10000000'); // 10 USDC (6 decimales)

function x402PayResponse() {
  return {
    x402Version: Number(X402_VERSION || 1),
    accepts: [
      {
        scheme: "exact",
        network: X402_NETWORK || "base",
        maxAmountRequired: PRICE.toString(),
        resource: "pay:x402apes:usdc10", // identificador del recurso de pago
        description: "Pay 10 USDC to the x402Apes treasury. After paying, use /api/confirm with the txHash to mint.",
        mimeType: "application/json",
        payTo: TREASURY_ADDRESS,
        maxTimeoutSeconds: Number(X402_MAX_TIMEOUT_SECONDS || 600),
        asset: X402_ASSET || "USDC",
        // sin bodyFields: el usuario NO completa nada, solo paga
        outputSchema: {
          input: { type: "http", method: "POST", bodyType: "json" },
          output: { ok: true, note: "Payment completed. Now call /api/confirm with txHash." }
        },
        extra: { project: "x402Apes", type: "payment-only" }
      }
    ]
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    // IMPORTANTÍSIMO: x402scan exige HTTP 402 en el discovery
    return res.status(402).json(x402PayResponse());
  }
  if (req.method === 'POST') {
    // El pago lo ejecuta x402. No tenemos txHash acá por diseño (dos pasos).
    return res.status(200).json({
      ok: true,
      note: "USDC payment executed by x402. Next: use /api/confirm with the txHash to mint."
    });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
