import 'dotenv/config';
import { ethers } from 'ethers';

const {
  RPC_URL,
  USDC_ADDRESS,
  TREASURY_ADDRESS,
  NFT_CONTRACT_ADDRESS,
  OWNER_PRIVATE_KEY,
  X402_VERSION,
  X402_RESOURCE,
  X402_PRICE_USDC,
  X402_NETWORK,
  X402_ASSET,
  X402_MAX_TIMEOUT_SECONDS
} = process.env;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = OWNER_PRIVATE_KEY ? new ethers.Wallet(OWNER_PRIVATE_KEY, provider) : null;

const ERC20_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
const NFT_ABI  = [
  'function mintAfterPayment(address payer, uint256 quantity) external',
  'function owner() view returns (address)'
];

const nft = (NFT_CONTRACT_ADDRESS && wallet)
  ? new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, wallet)
  : null;

const processedTxs = new Set();
const PRICE = BigInt(X402_PRICE_USDC || '10000000'); // 10 USDC

function x402Response() {
  return {
    x402Version: Number(X402_VERSION || 1),
    accepts: [
      {
        scheme: "exact",
        network: X402_NETWORK || "base",
        maxAmountRequired: PRICE.toString(),
        resource: X402_RESOURCE || "mint:x402apes:1",
        description: "Mint one x402Apes NFT automatically after USDC payment confirmation.",
        mimeType: "application/json",
        payTo: TREASURY_ADDRESS,
        maxTimeoutSeconds: Number(X402_MAX_TIMEOUT_SECONDS || 600),
        asset: X402_ASSET || "USDC",
        // txHash ahora es OPCIONAL: x402 lo completa automáticamente tras el pago.
        outputSchema: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            bodyFields: {
              txHash: {
                type: "string",
                required: false,
                description: "Filled automatically by x402 after payment. Leave empty."
              },
              resource: {
                type: "string",
                required: false,
                description: "Optional echo of the resource id."
              }
            },
            // opcional: headers que x402 podría usar
            headerFields: {
              "x-402-txhash": {
                type: "string",
                required: false,
                description: "Alternative place where x402 may send the txHash."
              }
            }
          },
          output: {
            ok: true,
            mintedTo: "0x...",
            nftTxHash: "0x...",
            note: "Mint completed."
          }
        },
        extra: { project: "x402Apes", autoConfirm: true, onePerPayment: true }
      }
    ]
  };
}

function extractTxHash(req) {
  if (req.body && typeof req.body.txHash === 'string') return req.body.txHash;
  const hdr = (n) => (Array.isArray(req.headers[n]) ? req.headers[n][0] : req.headers[n]);
  return hdr('x-402-txhash') || hdr('x-402-tx-hash') || hdr('x-tx-hash') || (typeof req.query?.txHash === 'string' ? req.query.txHash : null);
}
const isValidTxHash = (tx) => typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx);

async function verifyUsdcPayment(txHash) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('Transaction not found');
  if (receipt.status !== 1) throw new Error('Transaction failed');

  const iface = new ethers.Interface(ERC20_ABI);
  const usdcLC = USDC_ADDRESS.toLowerCase();
  const treasLC = TREASURY_ADDRESS.toLowerCase();

  let payer = null, paid = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcLC) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === 'Transfer' && parsed.args.to.toLowerCase() === treasLC) {
        paid += BigInt(parsed.args.value.toString());
        if (!payer) payer = parsed.args.from;
      }
    } catch {}
  }
  if (!payer) throw new Error('No USDC Transfer to TREASURY found in tx');
  if (paid < PRICE) throw new Error(`Insufficient amount: paid=${paid} required=${PRICE}`);
  return ethers.getAddress(payer);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(402).json(x402Response());
    }

    if (req.method === 'POST') {
      if (!wallet || !nft) {
        return res.status(500).json({ x402Version: Number(X402_VERSION || 1), error: 'Server misconfigured: missing OWNER_PRIVATE_KEY or NFT_CONTRACT_ADDRESS' });
      }

      // Aceptamos resource si viene, pero no lo exigimos
      if (req.body?.resource && req.body.resource !== (X402_RESOURCE || 'mint:x402apes:1')) {
        return res.status(400).json({ error: 'Invalid resource' });
      }

      const txHash = extractTxHash(req);
      if (!isValidTxHash(txHash)) {
        // Esto ocurre cuando aprietan "Fetch" sin pagar (POST vacío del tester)
        return res.status(400).json({
          error: 'Missing txHash',
          hint: 'Click “Fetch 10,00 US$” and approve payment; x402 will send txHash automatically.'
        });
      }
      if (processedTxs.has(txHash)) {
        return res.status(200).json({ ok: true, note: 'Already processed', txHash });
      }

      // onlyOwner pre-check
      const onchainOwner = await nft.owner();
      if (onchainOwner.toLowerCase() !== wallet.address.toLowerCase()) {
        return res.status(400).json({
          x402Version: Number(X402_VERSION || 1),
          error: 'Misconfiguration: signer is not contract owner',
          details: { onchainOwner, signer: wallet.address, contract: NFT_CONTRACT_ADDRESS }
        });
      }

      const payer = await verifyUsdcPayment(txHash);
      const tx = await nft.mintAfterPayment(payer, 1, { gasLimit: 300000n });
      const rec = await tx.wait();

      processedTxs.add(txHash);
      return res.status(200).json({ ok: true, mintedTo: payer, nftTxHash: rec.hash, note: 'Minted automatically after USDC payment confirmation.' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ x402Version: Number(X402_VERSION || 1), error: err?.message || 'Internal error' });
  }
}
