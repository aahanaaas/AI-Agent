# Dependency Doctor

One place for developers to check the health of their dependencies in 7 ecosystems, with every claim backed by an official source or a real search result.

| Language | Manifest | Registry used |
|---|---|---|
| Python | requirements.txt | PyPI |
| JavaScript | package.json | npm (via deps.dev) |
| Rust | Cargo.toml | crates.io (via deps.dev) |
| Go | go.mod | Go modules (via deps.dev) |
| Java | pom.xml | Maven Central (via deps.dev) |
| Ruby | Gemfile | RubyGems |
| PHP | composer.json | Packagist |

## Backend setup (Python 3.11+)

The API uses SerpApi for current web search, Gemini for evidence-grounded summaries, official package registries for release metadata, and OSV.dev for vulnerability data. Create API keys for [SerpApi](https://serpapi.com) and [Google AI Studio](https://aistudio.google.com/apikey), then copy `.env.example` to `.env` and add them locally. Never commit `.env` or real credentials.

Create a virtual environment, install dependencies, and start the API:

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend:app --reload
```

On macOS/Linux, activate the environment with `source venv/bin/activate`. Check `http://127.0.0.1:8000/health` and open the interactive API docs at `http://127.0.0.1:8000/docs`. Health reports whether keys are configured; it never returns the keys themselves.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service status and supported ecosystems |
| `POST` | `/audit` | Analyze dependencies from a manifest, including vulnerability and maintenance evidence |
| `POST` | `/compare` | Compare two libraries and return linked, quote-verified claims |
| `POST` | `/ask` | Answer a question using current, cited sources |

Example `POST /audit` request:

```json
{"manifest": "flask==1.0\nrequests\nnumpy", "goal": "small web API", "auto_compare": false}
```

Example `POST /compare` request:

```json
{"lib_a": "flask", "lib_b": "fastapi", "ecosystem": "pypi", "use_case": "small API"}
```

Example `POST /ask` request:

```json
{"question": "What are FastAPI's official recommendations for async code?"}
```

The audit manifest type is auto-detected; override with `manifest_type` (`pypi`, `npm`, `cargo`, `go`, `rubygems`, `packagist`, or `maven`). Invalid requests return an HTTP error with a `detail` message. The audit limit is 12 dependencies per request.

## Backend configuration

| Variable | Required | Purpose |
|---|---|---|
| `SERPAPI_KEY` | Yes for search, audit, and non-built-in comparisons | Retrieves current search evidence |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Yes when using Gemini | Generates grounded summaries |
| `LLM_PROVIDER` | No | `gemini` by default; `anthropic` is also supported |
| `MODEL` | No | Overrides the model selected for the provider |
| `MAX_CREDITS` | No | SerpApi search-credit limit per audit (default: 24) |
| `FRONTEND_ORIGINS` | No | Comma-separated browser origins allowed by CORS; Render config allows the deployed Vercel origin |

`/compare` for FastAPI vs Flask uses their official documentation and does not require SerpApi. Other search-backed operations require a SerpApi key and SDK. The service starts without the SDK, but those operations return a clear `503` error if it is missing.

## Frontend

The React app in the repository root uses the same `.env` file. For local development, `VITE_API_BASE_URL` optionally selects the backend base URL (defaults to `http://127.0.0.1:8000`), then run:

```
npm install
npm run dev
```

The Vite development server proxies `/api` requests to `VITE_API_BASE_URL`. In production, set the frontend's `VITE_API_BASE_URL` to the backend base URL. The backend's `FRONTEND_ORIGINS` setting must allow the deployed frontend origin.

The frontend has separate **Audit dependencies** and **Compare libraries** modes. Audits send manifest text to `POST /audit`; comparisons send two package names, ecosystem, and use case to `POST /compare`, then display the verdict and linked evidence.

**Model:** Gemini free tier by default (`gemini-3.5-flash-lite`). Google retires models from time to time; if you see a "model no longer available" error, set `MODEL=` in `.env` to the model name named in the error. To use Claude instead: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`, `pip install anthropic`.

**Tests:** Run the backend unit tests with `python -m unittest discover -s tests -v`; they do not call external services or consume API credits. With the server running, `python smoke_test.py` runs live integration checks. `--full` adds npm, while `--all` adds Rust, Go, Java, Ruby, PHP, and `auto_compare`; these integration options use SerpApi credits.

## Deploy on Render

This repository includes a `render.yaml` Blueprint for the FastAPI backend. In Render, create or sync a Blueprint Instance from this repository and provide `SERPAPI_KEY` and `GEMINI_API_KEY` when prompted. Keep these keys in Render's environment settings; never commit real credentials. The Blueprint configures CORS for `https://frontend-henna-kappa-19.vercel.app`; update `FRONTEND_ORIGINS` if the frontend uses a different domain.

After deployment, check `/health` and open `/docs` on the service URL. The SQLite cache and audit history are stored in `doctor.db`; on Render's default ephemeral filesystem, that local state may be lost when the service restarts or redeploys.

The production API is available at `https://ai-agent-33ns.onrender.com`; check `/health` after deployment. The SQLite cache and audit history are stored in `doctor.db`. On Render's default ephemeral filesystem, this local state may be lost when the service restarts or redeploys.

## Which version is checked

If the manifest pins an exact version (`flask==1.0`, `"express": "4.17.1"`, Go `v1.6.3`, Maven `<version>2.14.1</version>`, Ruby `gem 'rails', '7.0.0'`, PHP `"guzzlehttp/guzzle": "7.4.0"`), that exact version is checked for vulnerabilities. For ranges (`^10.0`, `~> 4.0`) and Cargo requirements, the latest release is checked, because the installed version is only known from lock files, which are not read.

## How SerpApi is used (core of the product)

All search goes through the official `serpapi` Python SDK (one cached, budgeted function).

| Engine | When | Credits | What it gives |
|---|---|---|---|
| Google News | every dependency | 1 each | deprecation, vulnerability, abandonment news |
| Google Jobs | riskiest 3 | 1 each | job demand = adoption signal |
| Google Trends | riskiest 3 | 1 each | is search interest rising, stable or falling over 12 months |
| Google Search | riskiest 3, and /compare | 1 each | alternatives and comparison articles |

Official registries and OSV.dev are free and use no SerpApi credits, so the 250 free credits/month go to what only search data can provide.

## Why the results can be trusted

- Versions, release dates and deprecation flags come from official registries, not from an LLM.
- Known vulnerabilities come from OSV.dev, with links to each advisory.
- The LLM only writes the plan from collected evidence. Every claim must cite evidence IDs.
- Grounding check: invented evidence is dropped, and "replace" advice without evidence is downgraded.
- In /compare, each claim must include a quote that really exists in the cited source.

## Cost control

Cheap triage for all dependencies, deep dive only on the riskiest 3, 12h SQLite cache, and a hard cap per audit (`MAX_CREDITS`, default 24). SQLite also remembers past audits to show what changed.

## Security

API keys belong in your local `.env` (ignored by git) or the hosting provider's environment settings; never put real keys in source control. The backend makes outbound requests to SerpApi, the configured LLM provider, public package registries, deps.dev, and OSV.dev.
