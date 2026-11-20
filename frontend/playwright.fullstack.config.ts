import { defineConfig, devices } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/**
 * FULL-STACK e2e: a real FastAPI backend (uvicorn from backend/.venv), the real MCP server, the real Vite dev server and a
 * scripted OpenAI-compatible model (TEST DOUBLE — no real AI key is needed or used).
 *
 *   main stack   backend :8100  MCP :8101  scripted model :8102  vite :5273   (AI key set to a dummy → points at the double)
 *   no-key stack backend :8110                                    vite :5274   (AI_API_KEY empty → AI_KEY_MISSING; 5 MB upload limit)
 *
 * Storage lives under e2e/.tmp (wiped on every start). Ports are unusual on purpose so a running dev stack is not disturbed.
 */
const ROOT = join(import.meta.dirname, '..')
const BACKEND = join(ROOT, 'backend')
const MCP = join(ROOT, 'mcp-server')
const TMP = join(import.meta.dirname, 'e2e', '.tmp')
const PY = join(BACKEND, '.venv', 'bin', 'python')

const secret = () => randomBytes(32).toString('base64url')
const JWT = secret()
const MCP_SECRET = secret()

const common = {
  ENV: 'development',
  // the e2e suites test real sign-in; never inherit LOCAL_TEST_MODE from a developer's .env
  LOCAL_TEST_MODE: 'false',
  JWT_SECRET: JWT,
  RATE_LIMIT: '0',
  AUTH_RATE_LIMIT: '0',
  AI_RATE_LIMIT: '0',
  MAX_UPLOAD_MB: '60',
  FILE_TTL_MINUTES: '60',
  GS_PATH: '',
  SOFFICE_PATH: '',
  TESSERACT_PATH: '',
  PYTHONUNBUFFERED: '1',
}
const storageA = join(TMP, 'fs-main')
const storageB = join(TMP, 'fs-nokey')
const mainEnv = {
  ...common,
  STORAGE_DIR: storageA,
  CORS_ORIGINS: 'http://localhost:5273',
  AI_ENDPOINT: 'http://127.0.0.1:8102/v1',
  AI_MODEL: 'scripted-model',
  AI_API_KEY: 'test-key-not-a-real-key',
  MCP_SHARED_SECRET: MCP_SECRET,
  MCP_URL: 'http://127.0.0.1:8101/mcp',
  MCP_PORT: '8101',
  MCP_HOST: '127.0.0.1',
}

export default defineConfig({
  testDir: './e2e/fullstack',
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'], acceptDownloads: true },
  projects: [
    { name: 'main', testIgnore: /nokey\.spec\.ts/, use: { baseURL: 'http://localhost:5273' } },
    { name: 'nokey', testMatch: /nokey\.spec\.ts/, use: { baseURL: 'http://localhost:5274' } },
  ],
  webServer: [
    {
      command: `rm -rf "${storageA}" && mkdir -p "${storageA}" && cd "${BACKEND}" && "${PY}" -m uvicorn app.main:app --host 127.0.0.1 --port 8100`,
      url: 'http://127.0.0.1:8100/api/health',
      env: mainEnv,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    { command: `cd "${MCP}" && "${PY}" -m rooman_pdf_mcp`, port: 8101, env: mainEnv, reuseExistingServer: false, timeout: 90_000 },
    { command: 'node e2e/fullstack/fakeLlm.mjs', port: 8102, env: { FAKE_LLM_PORT: '8102' }, reuseExistingServer: false, timeout: 30_000 },
    {
      command: 'npx vite --port 5273 --strictPort',
      url: 'http://localhost:5273',
      env: { VITE_PROXY_TARGET: 'http://127.0.0.1:8100' },
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: `rm -rf "${storageB}" && mkdir -p "${storageB}" && cd "${BACKEND}" && "${PY}" -m uvicorn app.main:app --host 127.0.0.1 --port 8110`,
      url: 'http://127.0.0.1:8110/api/health',
      // MAX_UPLOAD_MB=5: the matrix checks the upload limit here (the no-key tests only use small files)
      env: { ...common, STORAGE_DIR: storageB, CORS_ORIGINS: 'http://localhost:5274', AI_API_KEY: '', MCP_SHARED_SECRET: MCP_SECRET, MAX_UPLOAD_MB: '5' },
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'npx vite --port 5274 --strictPort',
      url: 'http://localhost:5274',
      env: { VITE_PROXY_TARGET: 'http://127.0.0.1:8110' },
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
})
