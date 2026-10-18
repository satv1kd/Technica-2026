/**
 * One-time PVOO setup on devnet:
 *   1. create a devnet-only authority keypair (unless one is in .env),
 *   2. fund it from the devnet faucet if it has no SOL,
 *   3. create the PVOO mint and custody account,
 * then append SOLANA_PAYER_SECRET_KEY and PVOO_MINT_ADDRESS to .env.
 *
 *   npm run chain:setup
 *
 * Devnet SOL is free test currency with no value; never reuse this key on mainnet.
 */
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { repoPath } from "../paths";
import { PvooChain, keypairFromSecret } from "./pvoo";

const ENV_PATH = repoPath(".env");

function setEnv(key: string, value: string) {
  const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
  fs.writeFileSync(ENV_PATH, next);
}

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");

  let payer: Keypair;
  if (process.env.SOLANA_PAYER_SECRET_KEY?.trim()) {
    payer = keypairFromSecret(process.env.SOLANA_PAYER_SECRET_KEY);
    console.log(`Using existing authority ${payer.publicKey.toBase58()}`);
  } else {
    payer = Keypair.generate();
    setEnv("SOLANA_PAYER_SECRET_KEY", bs58.encode(payer.secretKey));
    console.log(`Created devnet authority ${payer.publicKey.toBase58()} (saved to .env)`);
  }

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log("Requesting 1 devnet SOL from the faucet...");
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      console.log("Funded.");
    } catch (err) {
      console.error(
        `Faucet refused (${(err as Error).message}).\n` +
          `Fund ${payer.publicKey.toBase58()} at https://faucet.solana.com (devnet), then rerun.`,
      );
      process.exit(2);
    }
  }

  if (process.env.PVOO_MINT_ADDRESS?.trim()) {
    console.log(`PVOO mint already set: ${process.env.PVOO_MINT_ADDRESS}`);
    return;
  }
  const chain = await PvooChain.create(connection, payer);
  setEnv("PVOO_MINT_ADDRESS", chain.mintAddress);
  console.log(`Created PVOO mint ${chain.mintAddress} (saved to .env)`);
  console.log(`https://explorer.solana.com/address/${chain.mintAddress}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
