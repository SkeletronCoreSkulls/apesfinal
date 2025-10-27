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
const PRICE = BigInt(X402_PRICE_USDC || '10000000'); // 10 USDC por defecto

// -------- helpers --------
async function verifyUsdcPayment(txHash) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('Transaction not found');
  if (receipt.status !== 1) throw new Error('Transaction failed');

  const iface = new ethers.Interface(ERC20_ABI);
  const usdcLC = USDC_ADDRESS.toLowerCase();
  const treasLC = TREASURY_ADDRESS.toLowerCase();

  let payer = null;
  let paid  = 0n;

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
        // SIN bodyFields → la UI no pedirá inputs
        outputSchema: {
          input: { type: "http", method: "POST", bodyType: "json" },
          output: { ok: true, mintedTo: "0x...", nftTxHash: "0x...", note: "Mint completed." }
        },
        extra: { project: "x402Apes", autoConfirm: true, onePerPayment: true }
      }
    ]
  };
}

// -------- handler --------
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Para x402scan: discovery debe responder 402
      res.setHeader('Content-Type', 'application/json');
      return res.status(402).json(x402Response());
    }

    if (req.method === 'POST') {
      if (!wallet || !nft) {
        return res.status(500).json({
          x402Version: Number(X402_VERSION || 1),
          error: 'Server misconfigured: missing OWNER_PRIVATE_KEY or NFT_CONTRACT_ADDRESS'
        });
      }

      // x402scan nos envía el txHash del pago en el body
      const { resource, txHash } = req.body || {};
      if (!txHash) return res.status(400).json({ error: 'Missing txHash' });
      if (resource && resource !== (X402_RESOURCE || 'mint:x402apes:1')) {
        return res.status(400).json({ error: 'Invalid resource' });
      }
      if (processedTxs.has(txHash)) {
        return res.status(200).json({ ok: true, note: 'Already processed', txHash });
      }

      // signer debe ser el owner del contrato (onlyOwner)
      const onchainOwner = await nft.owner();
      if (onchainOwner.toLowerCase() !== wallet.address.toLowerCase()) {
        return res.status(400).json({
          x402Version: Number(X402_VERSION || 1),
          error: 'Misconfiguration: signer is not contract owner',
          details: { onchainOwner, signer: wallet.address, contract: NFT_CONTRACT_ADDRESS }
        });
      }

      // verificar pago USDC → treasury y obtener payer
      const payer = await verifyUsdcPayment(txHash);

      // mintear 1 al payer
      const tx = await nft.mintAfterPayment(payer, 1, { gasLimit: 300000n });
      const rec = await tx.wait();

      processedTxs.add(txHash);
      return res.status(200).json({
        ok: true,
        mintedTo: payer,
        nftTxHash: rec.hash,
        note: 'Minted automatically after USDC payment confirmation.'
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({
      x402Version: Number(X402_VERSION || 1),
      error: err?.message || 'Internal error'
    });
  }
}