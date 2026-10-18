import type { AddressInfo } from "node:net";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChainTimeout,
  PvooChain,
  fromBaseUnits,
  keypairFromSecret,
  toBaseUnits,
  withTimeout,
  type Chain,
} from "@services/chain/pvoo";
import { createServer } from "@services/chain/server";
import bs58 from "bs58";

describe("amounts", () => {
  it("converts decimal strings to 6-decimal base units and back", () => {
    expect(toBaseUnits("2")).toBe(2_000_000n);
    expect(toBaseUnits("0.37")).toBe(370_000n);
    expect(toBaseUnits("0.000001")).toBe(1n);
    expect(fromBaseUnits(2_370_000n)).toBe("2.37");
    expect(fromBaseUnits(3_000_000n)).toBe("3");
  });

  it.each(["0", "-1", "abc", "1.0000001", "1e3", ""])("rejects %s", (bad) => {
    expect(() => toBaseUnits(bad)).toThrow(RangeError);
  });
});

describe("keys", () => {
  it("reads base58 and JSON-array secret keys", () => {
    const kp = Keypair.generate();
    expect(keypairFromSecret(bs58.encode(kp.secretKey)).publicKey.equals(kp.publicKey)).toBe(true);
    expect(keypairFromSecret(JSON.stringify([...kp.secretKey])).publicKey.equals(kp.publicKey)).toBe(true);
  });
});

describe("withTimeout", () => {
  it("rejects slow operations", async () => {
    await expect(withTimeout("op", new Promise(() => {}), 50)).rejects.toBeInstanceOf(ChainTimeout);
  });
});

// HTTP service ---------------------------------------------------------------

class FakeChain implements Chain {
  mintAddress = "FakeMint111";
  total = 0n;
  fail = false;
  private n = 0;
  async mint(a: string) { return this.op(a, 1n); }
  async burn(a: string) { return this.op(a, -1n); }
  async supply() { return fromBaseUnits(this.total); }
  private async op(a: string, sign: bigint) {
    const units = toBaseUnits(a);
    if (this.fail) throw new Error("rpc down");
    this.total += sign * units;
    const signature = `sig${++this.n}`;
    return { signature, settle_ms: 5, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
  }
}

const servers: { close: () => void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(chain: Chain) {
  const logs: string[] = [];
  const { server } = createServer(chain, (m) => logs.push(m));
  await new Promise<void>((r) => server.listen(0, r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { base, post, logs };
}

describe("chain service", () => {
  it("mints, burns, and reports supply", async () => {
    const chain = new FakeChain();
    const { base, post } = await start(chain);
    const minted = await (await post("/mint", { amount: "2" })).json();
    expect(minted.signature).toBe("sig1");
    expect(minted.explorer).toMatch(/^https:\/\/explorer\.solana\.com\/tx\/sig1\?cluster=devnet$/);
    expect(typeof minted.settle_ms).toBe("number");
    await post("/burn", { amount: "1" });
    expect(await (await fetch(base + "/supply")).json()).toEqual({ mint: "FakeMint111", supply: "1" });
  });

  it("rejects bad amounts with 400", async () => {
    const { post } = await start(new FakeChain());
    expect((await post("/mint", { amount: "-3" })).status).toBe(400);
    expect((await post("/mint", {})).status).toBe(400);
  });

  it("answers 503 with the last good Explorer link when devnet fails, and logs it", async () => {
    const chain = new FakeChain();
    const { post, logs } = await start(chain);
    const ok = await (await post("/mint", { amount: "1" })).json();
    chain.fail = true;
    const r = await post("/mint", { amount: "1" });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error).toBe("chain_unavailable");
    expect(body.example_explorer).toBe(ok.explorer);
    expect(logs[0]).toMatch(/POST \/mint failed/);
  });

  it("times out against an unreachable RPC instead of hanging", async () => {
    const chain = new PvooChain(
      new Connection("http://127.0.0.1:9", { commitment: "confirmed", disableRetryOnRateLimit: true }),
      Keypair.generate(),
      Keypair.generate().publicKey,
      500,
    );
    const { post } = await start(chain);
    const started = Date.now();
    const r = await post("/mint", { amount: "1" });
    expect(r.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("PvooChain", () => {
  it("derives the custody account from the mint", () => {
    const chain = new PvooChain(new Connection("http://127.0.0.1:9"), Keypair.generate(), new PublicKey("So11111111111111111111111111111111111111112"));
    expect(chain.mintAddress).toBe("So11111111111111111111111111111111111111112");
  });
});
