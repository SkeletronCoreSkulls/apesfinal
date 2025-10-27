# x402Apes – x402scan Integration (Vercel)

Exposes two routes:

- **GET /api/402** → returns **HTTP 402** with strict `X402Response` for x402scan discovery (shows the USDC pay button). No inputs.
- **POST /api/notify** → called by x402 AFTER payment; body `{ "resource": "mint:x402apes:1", "txHash": "0x..." }`. Verifies the USDC transfer on Base and mints **1 NFT** to the payer.

Payment is executed by x402/x402scan, not by your backend.

### Environment Variables
See `.env.example` and configure them in Vercel Project → Settings → Environment Variables.

### Smoke checks
- `curl -i https://<app>.vercel.app/api/402` → should return HTTP 402 with JSON schema.
- After a real USDC payment to treasury, call:
  `curl -X POST "https://<app>.vercel.app/api/notify" -H "Content-Type: application/json" --data '{"resource":"mint:x402apes:1","txHash":"0x<hash>"}'`
