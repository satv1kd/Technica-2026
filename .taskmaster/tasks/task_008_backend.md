# Task ID: 8

**Title:** Blockchain: PVOO SPL Token on Solana Devnet with Mint/Burn/Supply

**Status:** in-progress

**Dependencies:** 7 ✓

**Priority:** high

**Description:** Deploy PVOO token on Solana devnet as an SPL token with 6 decimals. Implement mint (on buy), burn (on sell), and supply check endpoints. Include ledger-only fallback for RPC failures.

**Details:**

Solana chain service implementation:
1. Create services/chain/ Node.js service
2. Use @solana/web3.js v1 and @solana/spl-token
3. Generate or import devnet keypair for program authority (stored in env SOLANA_PAYER_SECRET_KEY)
4. Create PVOO mint with 6 decimals
5. Implement REST API:
   - POST /mint {amount} - mint PVOO tokens, return tx signature and Explorer link
   - POST /burn {amount} - burn PVOO tokens, return tx signature
   - GET /supply - get on-chain token supply via getTokenSupply RPC call
6. Measure and return settlement time in milliseconds
7. Implement 8-second timeout on RPC calls
8. Add ledger-only fallback: if RPC fails, record trade in ledger but mark as "simulated settlement" and return previous Explorer link as example
9. Log all RPC failures for monitoring

Node.js pseudo-code:
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, mintTo, burn, getAccount } from '@solana/spl-token';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const payer = Keypair.fromSecretKey(bs58.decode(SOLANA_PAYER_SECRET_KEY));

// One-time setup
const mint = await createMint(connection, payer, payer.publicKey, null, 6);

// On buy
const startMs = Date.now();
const sig = await mintTo(connection, payer, mint, tokenAccount, payer, amount * 1e6);
const settleMs = Date.now() - startMs;
return { signature: sig, settleMs, explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=devnet` };

**Test Strategy:**

Integration test on devnet: Mint 2 PVOO, verify supply is 2. Burn 1, verify supply is 1. Test RPC timeout by using invalid endpoint, verify ledger-only fallback activates. Verify Explorer URLs are valid. Test concurrent mints to ensure no race conditions.
