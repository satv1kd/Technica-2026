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

4. Create the database schema:

   ```bash
   psql "$DATABASE_URL" -f services/data/schema.sql
   ```

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

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app in development mode |
| `npm run build` | Production build of the web app |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | Type-check the whole repo |

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
