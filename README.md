# Sonar

A voice-first investing tutor for blind and low-vision learners, built at Technica 2026.
Hold the space bar to talk, practice with $10,000 of simulated money, feel price charts
drawn on your palm (or hear them as tones), and learn how tokenized funds work with PVOO,
a practice token on Solana devnet. No real money moves.

The full spec is in [.taskmaster/docs/prd.txt](.taskmaster/docs/prd.txt).

## Requirements

- Node.js 20 or newer
- A Tiger Data (Postgres + TimescaleDB) database
- API keys for Gemini and ElevenLabs

## Setup

1. Install dependencies from the repo root:

   ```bash
   npm install
   ```

2. Create your environment file. There is one `.env` at the repo root, shared by every service. It is gitignored, so never commit it.

   ```bash
   cp .env.example .env
   ```

3. Fill in the required keys:

   | Key | Required | Where to get it |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | yes | https://aistudio.google.com/apikey |
   | `ELEVENLABS_API_KEY` | yes | ElevenLabs dashboard, under API keys |
   | `DATABASE_URL` | yes | Tiger Data console; must start with `postgres://` or `postgresql://` |
   | `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | no | Alpaca paper trading; without them, prices come from `data/fallback/*.csv` |
   | `SOLANA_PAYER_SECRET_KEY` | no | A devnet keypair; without it, PVOO trades use ledger-only settlement |
   | `SOLANA_RPC_URL`, `ENGINE_URL`, `CHAIN_URL`, `GEMINI_MODEL`, `ELEVENLABS_VOICE_ID` | no | Defaults are in `.env.example` |

4. Create the database schema. The script is idempotent, so you can rerun it after pulling schema changes. It only needs `DATABASE_URL`.

   ```bash
   npm run db:migrate
   ```

   After a historical price backfill, materialize the weekly and monthly candles (the hourly refresh policy only covers recent data):

   ```bash
   npm run db:refresh
   ```

   To run the database integration tests, point them at a throwaway TimescaleDB:

   ```bash
   TEST_DATABASE_URL=postgres://... npm run test:db
   ```

   For a local database, `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pw timescale/timescaledb:latest-pg17` works with `postgres://postgres:pw@localhost:5432/postgres`.

5. Start the app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

If a required key is missing, empty, or still a placeholder, the server refuses to start
and lists every problem at once:

```
Sonar configuration error:
  - GEMINI_API_KEY is missing
  - DATABASE_URL must be a postgres:// or postgresql:// connection string
Copy .env.example to .env at the repo root and fill these in.
```

## Trading engine

The practice brokerage is a Python FastAPI service in `services/engine`. It reads the same root `.env`.

```bash
cd services/engine
py -3.13 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn api:app --port 8000
```

(On macOS or Linux, use `python3 -m venv .venv` and `.venv/bin/python`.)

| Endpoint | What it does |
| --- | --- |
| `GET /markets` | Tradable assets: VOO, SPY, QQQ, AAPL, MSFT, NVDA, PVOO |
| `GET /quote?symbol=VOO` | Last close, plus a spoken note when the market is closed |
| `GET /history?symbol=AAPL&range=1m` | Daily closes (`1w`, `1m`, `3m`, `6m`, `1y`, `2y`, or a date) |
| `POST /propose` `{side, symbol, qty}` | Step 1: price, total, risk note, and a read-back. Changes nothing. |
| `POST /confirm` `{id}` | Step 2: executes a live proposal (60 s). Otherwise `409`. |
| `POST /cancel` `{id}` | Drops a proposal |
| `GET /portfolio` | Cash, holdings, gain or loss, and a coaching tip every 3 trades |
| `POST /backtest` `{symbol, amount, start}` | End value, return, and maximum drawdown with dates |
| `GET /review` | Trade history, newest first |

Rules the engine enforces:
- Nothing trades without `/confirm`, and a proposal executes at most once.
- Cash never goes negative. The debit is conditional, and a database constraint backs it up.
- Stocks and ETFs trade in whole shares. PVOO allows fractions (up to 6 decimals).
- PVOO is priced 1:1 with VOO. If the chain service at `CHAIN_URL` doesn't answer within 8 seconds, the trade still fills and is marked `simulated`.
- Prices fill in whole cents, and weekend quotes say they are Friday's close.
- By default it trades on the "Demo learner" account. Set `ENGINE_ACCOUNT_ID` to use another.

Tests (the API tests run against the database on a throwaway account and clean up after themselves):

```bash
cd services/engine
.venv/Scripts/python -m pytest
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app in development mode |
| `npm run build` | Production build of the web app |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | Type-check the whole repo |
| `npm run db:migrate` | Create or update the database schema |
| `npm run db:refresh` | Materialize all weekly and monthly candles |
| `npm run test:db` | Database integration tests (needs `TEST_DATABASE_URL`) |

## Repository layout

```
apps/web/          Next.js app: UI, voice, tutor API routes
services/config/   Environment loading and validation
services/data/     Tiger Data schema, price ingest, chart series
services/lessons/  Lesson curriculum (JSON) and lesson engine
services/tutor/    Gemini function-calling loop and tools
services/engine/   Practice brokerage (two-step trades, ledger)
services/chain/    PVOO mint, burn, and supply on Solana devnet
firmware/          ESP32 palm-arm firmware
bridge/            Arm path planner and Web Serial helper
tests/             Unit and integration tests
```

## Task tracking

Tasks are generated from the PRD with [Task Master](https://github.com/eyaltoledano/claude-task-master):

```bash
task-master list
task-master next
```
