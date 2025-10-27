import 'dotenv/config';
import { ethers } from 'ethers';

const {
  RPC_URL,
  USDC_ADDRESS,
  TREASURY_ADDRESS,
  NFT_CONTRACT_ADDRESS,
  OWNER_PRIVATE_KEY,
  X402_VERSION,
  X402_NETWORK,
  X402_ASSET,
  X402_MAX_TIMEOUT_SECONDS,
  X402_PRICE_USDC
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

function x402ConfirmResponse() {
  return {
    x402Version: Number(X402_VERSION || 1),
    accepts: [
      {
        scheme: "exact",                 // seguimos declarando 'exact' para que x402scan lo trate como recurso válido
        network: X402_NETWORK || "base",
        maxAmountRequired: "0",          // este endpoint no cobra; solo confirma
        resource: "confirm:x402apes:mint",
        description: "Confirm a USDC payment by txHash and mint one x402Apes NFT to the payer.",
        mimeType: "application/json",
        payTo: TREASURY_ADDRESS,         // informativo
        maxTimeoutSeconds: Number(X402_MAX_TIMEOUT_SECONDS || 600),
        asset: X402_ASSET || "USDC",
        outputSchema: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            // AQUÍ el usuario (o x402 si algún día lo soporta en cadena de pasos) pasa el txHash
            bodyFields: {
              txHash: {
                type: "string",
                required: true,
                description: "USDC payment tx hash (Base). Must be a Transfer to the treasury."
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
        extra: { project: "x402Apes", type: "confirmation-only" }
      }
    ]
  };
}

function isValidTxHash(tx) {
  return typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx);
}

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

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Para que x402scan lo liste y muestre el campo txHash
      res.setHeader('Content-Type', 'application/json');
      return res.status(402).json(x402ConfirmResponse());
    }

    if (req.method === 'POST') {
      if (!wallet || !nft) {
        return res.status(500).json({ x402Version: Number(X402_VERSION || 1), error: 'Server misconfigured: missing OWNER_PRIVATE_KEY or NFT_CONTRACT_ADDRESS' });
      }

      const { txHash } = req.body || {};
      if (!isValidTxHash(txHash)) {
        return res.status(400).json({ error: 'Invalid or missing txHash' });
      }
      if (processedTxs.has(txHash)) {
        return res.status(200).json({ ok: true, note: 'Already processed', txHash });
      }

      // signer debe ser el owner del contrato
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
      return res.status(200).json({ ok: true, mintedTo: payer, nftTxHash: rec.hash, note: 'Minted after verified USDC payment.' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ x402Version: Number(X402_VERSION || 1), error: err?.message || 'Internal error' });
  }
}
