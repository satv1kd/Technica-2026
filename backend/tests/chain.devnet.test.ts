/**
 * Real Solana devnet. Needs a funded SOLANA_PAYER_SECRET_KEY (npm run chain:setup).
 * Creates its own throwaway mint so the real PVOO supply is never touched.
 *
 *   npm run test:devnet
 */
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { PvooChain, keypairFromSecret } from "@services/chain/pvoo";

const secret = process.env.SOLANA_PAYER_SECRET_KEY;

describe.skipIf(!secret)("PVOO on devnet", () => {
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  let chain: PvooChain;

  beforeAll(async () => {
    const payer = keypairFromSecret(secret!);
    const balance = await connection.getBalance(payer.publicKey);
    if (balance < 0.02 * LAMPORTS_PER_SOL) {
      throw new Error(`Authority ${payer.publicKey.toBase58()} has no devnet SOL. Fund it at https://faucet.solana.com`);
    }
    chain = await PvooChain.create(connection, payer);
  }, 90_000);

  it("mint 2, supply is 2; burn 1, supply is 1", async () => {
    const minted = await chain.mint("2");
    expect(minted.explorer).toBe(`https://explorer.solana.com/tx/${minted.signature}?cluster=devnet`);
    expect(minted.settle_ms).toBeGreaterThan(0);
    expect(await chain.supply()).toBe("2");

    await chain.burn("1");
    expect(await chain.supply()).toBe("1");
  }, 60_000);

  it("concurrent mints all land", async () => {
    const results = await Promise.all(["0.1", "0.2", "0.3"].map((a) => chain.mint(a)));
    expect(new Set(results.map((r) => r.signature)).size).toBe(3);
    expect(await chain.supply()).toBe("1.6");
  }, 60_000);

  it("the transaction is visible on chain", async () => {
    const { signature } = await chain.mint("0.4");
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(tx?.meta?.err).toBeNull();
  }, 60_000);
});
