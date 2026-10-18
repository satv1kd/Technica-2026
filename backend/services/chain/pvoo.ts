import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  burn,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/** PVOO uses 6 decimals, so 1 PVOO = 1,000,000 base units. */
export const DECIMALS = 6;
export const RPC_TIMEOUT_MS = 8_000;

export class ChainTimeout extends Error {
  constructor(op: string, ms: number) {
    super(`Solana devnet did not answer ${op} within ${ms / 1000} seconds.`);
    this.name = "ChainTimeout";
  }
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** "2", "0.37" -> base units. Rejects anything that isn't a positive decimal with <= 6 places. */
export function toBaseUnits(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) throw new RangeError(`Invalid PVOO amount: ${amount}`);
  const units = BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt((m[2] ?? "").padEnd(DECIMALS, "0"));
  if (units <= 0n) throw new RangeError("Amount must be more than zero.");
  return units;
}

export function fromBaseUnits(units: bigint): string {
  const whole = units / 10n ** BigInt(DECIMALS);
  const frac = (units % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function keypairFromSecret(secret: string): Keypair {
  const s = secret.trim();
  // Accept a base58 string or the JSON byte array that solana-keygen writes.
  return Keypair.fromSecretKey(s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s));
}

export function withTimeout<T>(op: string, p: Promise<T>, ms = RPC_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ChainTimeout(op, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export interface Settled {
  signature: string;
  settle_ms: number;
  explorer: string;
}

export interface Chain {
  mint(amount: string): Promise<Settled>;
  burn(amount: string): Promise<Settled>;
  supply(): Promise<string>;
  readonly mintAddress: string;
}

/**
 * Custodial PVOO on devnet: the service's keypair is the mint authority and
 * holds every token in its own associated token account. "In this demo, we
 * hold your keys, like a bank would."
 */
export class PvooChain implements Chain {
  private readonly account: PublicKey;

  constructor(
    private readonly connection: Connection,
    private readonly payer: Keypair,
    private readonly mintKey: PublicKey,
    private readonly timeoutMs = RPC_TIMEOUT_MS,
  ) {
    this.account = getAssociatedTokenAddressSync(mintKey, payer.publicKey);
  }

  get mintAddress(): string {
    return this.mintKey.toBase58();
  }

  /** One-time: create the PVOO mint and the custody account. */
  static async create(connection: Connection, payer: Keypair, timeoutMs = 60_000): Promise<PvooChain> {
    const mint = await withTimeout(
      "createMint",
      createMint(connection, payer, payer.publicKey, null, DECIMALS),
      timeoutMs,
    );
    const chain = new PvooChain(connection, payer, mint);
    await chain.ensureAccount(timeoutMs);
    return chain;
  }

  async ensureAccount(timeoutMs = this.timeoutMs): Promise<void> {
    await withTimeout(
      "createAccount",
      createAssociatedTokenAccountIdempotent(this.connection, this.payer, this.mintKey, this.payer.publicKey),
      timeoutMs,
    );
  }

  async mint(amount: string): Promise<Settled> {
    const units = toBaseUnits(amount);
    return this.timed("mint", () =>
      mintTo(this.connection, this.payer, this.mintKey, this.account, this.payer, units),
    );
  }

  async burn(amount: string): Promise<Settled> {
    const units = toBaseUnits(amount);
    return this.timed("burn", () =>
      burn(this.connection, this.payer, this.account, this.mintKey, this.payer, units),
    );
  }

  async supply(): Promise<string> {
    const res = await withTimeout("getTokenSupply", this.connection.getTokenSupply(this.mintKey), this.timeoutMs);
    return fromBaseUnits(BigInt(res.value.amount));
  }

  private async timed(op: string, send: () => Promise<string>): Promise<Settled> {
    const started = performance.now();
    const signature = await withTimeout(op, send(), this.timeoutMs);
    return { signature, settle_ms: Math.round(performance.now() - started), explorer: explorerUrl(signature) };
  }
}
