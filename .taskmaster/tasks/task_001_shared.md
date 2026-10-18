# Task ID: 1

**Title:** Foundation: Project Infrastructure and Configuration

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Set up monorepo structure, environment loading, secrets validation, and .env.example file. Ensure the app fails fast with clear messages when required API keys are missing.

**Details:**

Complete foundation setup:
1. Verify monorepo structure with workspaces configured in root package.json
2. Create .env.example with all required keys: GEMINI_API_KEY, ELEVENLABS_API_KEY, DATABASE_URL, and optional keys (ALPACA_KEY_ID, ALPACA_SECRET_KEY, SOLANA_RPC_URL, etc.)
3. Ensure services/config/index.ts is production-ready with proper Zod validation
4. Add .gitignore rules for .env, node_modules, .next, dist
5. Document setup steps in README.md
6. Verify loadConfig() throws ConfigError with missing key names when keys are absent

Implementation notes:
- config/index.ts already exists and looks complete
- Focus on .env.example creation and documentation
- Test with missing keys to ensure error messages are helpful

**Test Strategy:**

Unit test: Call loadConfig() with missing required keys and verify ConfigError is thrown with correct missing key names. Integration test: Run app without .env and confirm clear error message appears.
