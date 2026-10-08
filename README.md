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

## Setup (Python 3.11+)

1. Get two free keys:
   - SerpApi: https://serpapi.com (free plan, 250 searches/month)
   - Gemini: https://aistudio.google.com/apikey (free tier, no billing needed)
2. Copy `.env.example` to `.env` and paste your keys into it. Never commit `.env`.
3. Install and run:

```
python -m venv venv
venv\Scripts\activate          # Windows (Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
uvicorn backend:app --reload
```

Open http://127.0.0.1:8000/health (both key checks should say `true`), then http://127.0.0.1:8000/docs and try `POST /audit`:

```json
{"manifest": "flask==1.0\nrequests\nnumpy", "goal": "small web API", "auto_compare": false}
```

The manifest type is auto-detected; override with `manifest_type` (pypi, npm, cargo, go, rubygems, packagist, maven).

**Model:** Gemini free tier by default (`gemini-3.5-flash-lite`). Google retires models from time to time; if you see a "model no longer available" error, set `MODEL=` in `.env` to the model name named in the error. To use Claude instead: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`, `pip install anthropic`.

**Test:** with the server running, `python smoke_test.py` runs a quick check. `--full` adds npm, `--all` adds Rust, Go, Java, Ruby, PHP and `auto_compare` (uses more SerpApi credits).

## Deploy on Render

This repository includes a `render.yaml` Blueprint for the FastAPI backend. In Render, create a new Blueprint Instance from this repository and provide `SERPAPI_KEY` and `GEMINI_API_KEY` when prompted. Keep these keys in Render's environment settings; never commit real credentials.

After deployment, check `/health` and open `/docs` on the service URL. The SQLite cache and audit history are stored in `doctor.db`; on Render's default ephemeral filesystem, that local state may be lost when the service restarts or redeploys.

For a browser frontend hosted on a different domain, set `FRONTEND_ORIGINS` in Render's environment settings to its exact origin, including the scheme and any non-default port (for example, `https://my-app.example.com`). For multiple allowed frontend origins, separate them with commas. Local development allows `http://localhost:3000` and `http://localhost:5173` by default. Redeploy after changing this setting.

## Endpoints

- `POST /audit` - health report + action plan (keep / update / replace / monitor). `"auto_compare": true` also compares the top "replace" library with its alternative.
- `POST /compare` - `{"lib_a":"flask","lib_b":"fastapi","ecosystem":"pypi","use_case":"small API"}` -> verdict with `flips_if` (when the other library wins), quote-verified claims, sources.
- `GET /health`

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

API keys live only in your local `.env` (ignored by git) or environment variables. The backend runs locally; the only external services it calls are SerpApi, Gemini, PyPI/npm/other registries via their public APIs, deps.dev and OSV.dev.
