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

The practice brokerage is a Python FastAPI service in `backend/services/engine`. It reads the same root `.env`.

```bash
cd backend/services/engine
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
cd backend/services/engine
.venv/Scripts/python -m pytest
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app in development mode |
| `npm run build` | Production build of the web app |
| `npm test` | Run all unit tests (Vitest) |
| `npm run test:frontend` | Frontend unit tests only |
| `npm run test:backend` | Backend unit tests only |
| `npm run test:e2e` | Keyboard-only browser tests (Playwright) |
| `npm run typecheck` | Type-check the whole repo |
| `npm run db:migrate` | Create or update the database schema |
| `npm run db:refresh` | Materialize all weekly and monthly candles |
| `npm run test:db` | Database integration tests (uses `TEST_DATABASE_URL`, else `DATABASE_URL`) |
| `npm run chain:setup` / `npm run chain` | One-time PVOO devnet setup / run the chain service |
| `npm run test:devnet` | PVOO tests on Solana devnet (needs funded devnet SOL) |

## Repository layout

The code is split by team. Each side owns its folders; the API routes and two
contract files are the handshake between them.

```
frontend/                      Frontend team
  web/                         Next.js app
    app/page.tsx, components/  The single-screen UI
    lib/voice/                 Push-to-talk, earcons, streaming TTS player
    lib/palm/                  Palm scene drawing, arm motion, sonification
    lib/a11y/, lib/state/      Keymap, live region, app state machine
    app/api/                   Thin route handlers that call backend/ (owned by backend)
  tests/unit/                  State machine, palm, sonification tests
  tests/e2e/                   Keyboard-only Playwright tests

backend/                       Backend team
  services/engine/             Python: practice brokerage, ingest, chart series, CSV fallback
  services/tutor/              Gemini loop, 16 tools, guardrails, speech style
  services/lessons/            Curriculum JSON, step player, quiz, progress
  services/chain/              PVOO mint, burn, and supply on Solana devnet
  services/voice/              ElevenLabs STT and TTS with Gemini fallback and cache
  services/data/               Tiger Data schema, migrations, DB connection
  services/config/             Environment validation
  bridge/serial/               Arm path planner and Web Serial link
  firmware/                    ESP32 palm-arm firmware
  tests/                       Unit, database, and devnet tests

data/                          Shared: CSV price fallback (tts-cache is gitignored)
```

Contract files (changes need both teams to review):
- `backend/services/tutor/tools/types.ts`: the `Directive` and `TurnState` shapes the UI reacts to
- `backend/services/chart/ops.ts`: the chart drawing format used by the palm, sonification, and arm

## Task tracking

Tasks are generated from the PRD with [Task Master](https://github.com/eyaltoledano/claude-task-master)
and split into three tags. Pick yours once, and `list` and `next` show only your tasks:

```bash
task-master use-tag frontend   # or backend, or shared
task-master next
```

| Tag | Tasks |
| --- | --- |
| `frontend` | 4 app shell, 9 voice, 13 space bar and tray, 14 menus and settings, 15 answer card and quiz, 16 palm scene, 17 sonification, 18 trade confirm UI, 21 accessibility |
| `backend` | 2 schema, 3 lessons, 5 price ingest, 6 chart series, 7 trading engine, 8 PVOO chain, 10 tutor, 11 guardrails, 12 lesson engine, 19 firmware, 20 arm bridge, 24 options (stretch) |
| `shared` | 1 infrastructure, 22 integration testing, 23 demo and Devpost |

Dependencies that cross teams are listed in each task's details under "Cross-team dependencies".
The current tag is stored per person in `.taskmaster/state.json`, which is gitignored.
