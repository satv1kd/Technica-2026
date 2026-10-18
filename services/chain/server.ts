/**
 * PVOO chain service: POST /mint, POST /burn, GET /supply.
 *
 *   npm run chain
 *
 * When devnet fails or times out (8 s), it answers 503 with the most recent
 * successful Explorer link, so the tutor can say "here's an earlier example".
 */
import http from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";
import { Chain, PvooChain, keypairFromSecret } from "./pvoo";

export interface ChainState {
  lastExplorer: string | null;
  failures: number;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new RangeError("Body too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

export function createServer(chain: Chain, log: (msg: string) => void = console.warn) {
  const state: ChainState = { lastExplorer: null, failures: 0 };

  const server = http.createServer(async (req, res) => {
    const route = `${req.method} ${new URL(req.url ?? "/", "http://x").pathname}`;
    try {
      if (route === "GET /health") return send(res, 200, { ok: true, mint: chain.mintAddress });
      if (route === "GET /supply") {
        return send(res, 200, { mint: chain.mintAddress, supply: await chain.supply() });
      }
      if (route === "POST /mint" || route === "POST /burn") {
        const { amount } = await readJson(req);
        if (typeof amount !== "string" && typeof amount !== "number") {
          return send(res, 400, { error: "bad_amount", message: "amount is required" });
        }
        const op = route === "POST /mint" ? chain.mint.bind(chain) : chain.burn.bind(chain);
        const settled = await op(String(amount));
        state.lastExplorer = settled.explorer;
        return send(res, 200, settled);
      }
      return send(res, 404, { error: "not_found" });
    } catch (err) {
      const e = err as Error;
      if (e instanceof RangeError || e instanceof SyntaxError) {
        return send(res, 400, { error: "bad_amount", message: e.message });
      }
      state.failures += 1;
      log(`[chain] ${route} failed (${e.name}): ${e.message}`);
      return send(res, 503, {
        error: "chain_unavailable",
        message: e.message,
        example_explorer: state.lastExplorer,
      });
    }
  });
  return { server, state };
}

async function main() {
  const secret = process.env.SOLANA_PAYER_SECRET_KEY;
  const mint = process.env.PVOO_MINT_ADDRESS;
  if (!secret || !mint) {
    throw new Error("SOLANA_PAYER_SECRET_KEY and PVOO_MINT_ADDRESS must be set. Run `npm run chain:setup` once.");
  }
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const chain = new PvooChain(connection, keypairFromSecret(secret), new PublicKey(mint));
  const port = Number(new URL(process.env.CHAIN_URL || "http://localhost:8001").port || 8001);
  createServer(chain).server.listen(port, () => {
    console.log(`PVOO chain service on :${port}, mint ${chain.mintAddress}`);
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
