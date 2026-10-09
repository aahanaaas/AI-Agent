"""
Dependency Doctor - multi-ecosystem backend (async FastAPI)
Paste a dependency manifest -> sourced health report + action plan + optional comparison.

Ecosystems: Python (requirements.txt), npm (package.json), Rust (Cargo.toml), Go (go.mod),
Ruby (Gemfile), PHP (composer.json), Java (pom.xml)

Run:  uvicorn backend:app --reload        (Python 3.11+)
Keys: put them in a local .env file (never commit it) or export them as environment variables.
  SERPAPI_KEY, GEMINI_API_KEY   (default, free)
  optional: MODEL, MAX_CREDITS, LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY
"""
import os, re, json, time, hashlib, sqlite3, asyncio
from datetime import datetime, timezone
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import quote, urlparse


# ---------- tiny .env loader (no extra dependency). Real env vars win over .env ----------
def _load_env(path=".env"):
    p = Path(__file__).with_name(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

import httpx
try:
    import serpapi  # type: ignore[import-not-found]  # official SerpApi Python SDK
except ImportError:  # Optional dependency: the app can still start, but SerpApi-backed features fail clearly.
    serpapi = None

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import tomllib  # Python 3.11+
except ImportError:
    tomllib = None

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()  # gemini (free) | anthropic
MODEL = os.getenv("MODEL") or ("claude-sonnet-5-5" if LLM_PROVIDER == "anthropic" else "gemini-3.5-flash-lite")
MAX_DEPS, DEEP_K = 12, 3
MAX_CREDITS = int(os.getenv("MAX_CREDITS", "24"))  # SerpApi credits per audit (free plan = 250/month)
CACHE_TTL = 12 * 3600
RISK_WORDS = re.compile(r"deprecat|vulnerab|cve-|abandon|end.of.life|unmaintained|breaking change|archived", re.I)
OSV_ECO = {"pypi": "PyPI", "npm": "npm", "cargo": "crates.io", "go": "Go",
           "rubygems": "RubyGems", "packagist": "Packagist", "maven": "Maven"}
DEPSDEV = {"npm": "npm", "cargo": "cargo", "go": "go", "maven": "maven"}
LABEL = {"pypi": "python", "npm": "npm javascript", "cargo": "rust crate", "go": "go module",
         "rubygems": "ruby gem", "packagist": "php composer", "maven": "java maven"}
REPUTABLE_SOURCE_HOSTS = {
    "apnews.com", "bbc.com", "bbc.co.uk", "bmj.com", "britannica.com", "cochranelibrary.com",
    "ft.com", "jamanetwork.com", "nature.com", "nejm.org", "npr.org", "nytimes.com",
    "ourworldindata.org", "reuters.com", "science.org", "theguardian.com",
}
FASTAPI_FLASK_DOCS = (
    {"title": "FastAPI - Async: Concurrency and async/await",
     "link": "https://fastapi.tiangolo.com/async/"},
    {"title": "FastAPI - Benchmarks",
     "link": "https://fastapi.tiangolo.com/benchmarks/"},
    {"title": "Flask - Using async and await",
     "link": "https://flask.palletsprojects.com/en/stable/async-await/"},
    {"title": "Flask - Design Decisions",
     "link": "https://flask.palletsprojects.com/en/stable/design/"},
)

db = sqlite3.connect("doctor.db", check_same_thread=False)
db.execute("CREATE TABLE IF NOT EXISTS cache(k TEXT PRIMARY KEY, v TEXT, ts REAL)")
db.execute("CREATE TABLE IF NOT EXISTS audits(id INTEGER PRIMARY KEY, project TEXT, ts REAL, levels TEXT)")

app = FastAPI(title="Dependency Doctor")
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS", "http://localhost:3000,http://localhost:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
llm = None  # only used for the optional Anthropic provider


class AuditReq(BaseModel):
    manifest: str                 # contents of requirements.txt / package.json / Cargo.toml / ...
    manifest_type: str = "auto"   # auto | pypi | npm | cargo | go | rubygems | packagist | maven
    goal: str = ""                # what the project is for; helps pick alternatives
    auto_compare: bool = False    # also compare top "replace" library with its alternative (+2 credits)


class CompareReq(BaseModel):
    lib_a: str
    lib_b: str
    ecosystem: str = "pypi"
    use_case: str = "general purpose project"


class AskReq(BaseModel):
    question: str


def require_serpapi():
    if serpapi is None:
        raise HTTPException(
            503,
            "The SerpApi Python SDK is not installed. Install dependencies from requirements.txt.",
        )


# ---------- Manifest parsing ----------
def detect(text: str) -> str:
    t = text.lstrip()
    if t.startswith("{"):
        try:
            j = json.loads(t)
        except Exception:
            raise HTTPException(400, "Invalid JSON manifest")
        return "packagist" if "require" in j and "dependencies" not in j else "npm"
    if "<project" in t or "<dependency>" in t:
        return "maven"
    if re.search(r"^\[(dependencies|package)\]", t, re.M):
        return "cargo"
    if re.search(r"^(module|require)\s", t, re.M):
        return "go"
    if re.search(r"^\s*gem\s+['\"]", t, re.M):
        return "rubygems"
    return "pypi"


def parse_manifest(text: str, kind: str = "auto") -> list:
    kind = detect(text) if kind == "auto" else kind
    if kind not in OSV_ECO:
        raise HTTPException(400, f"Unsupported manifest type: {kind}")
    deps = []
    try:
        if kind == "pypi":
            for line in text.splitlines():
                line = line.split("#")[0].strip()
                if not line or line.startswith("-"):
                    continue
                m = re.match(r"[A-Za-z0-9][A-Za-z0-9._\-]*", line)
                if m:
                    p = re.search(r"==\s*([\w.\-]+)", line)
                    deps.append((m.group(0).lower(), p.group(1) if p else None))
        elif kind == "npm":
            j = json.loads(text)
            for sect in ("dependencies", "devDependencies"):
                for n, v in (j.get(sect) or {}).items():
                    deps.append((n, v if re.fullmatch(r"\d+\.\d+\.\d+", v) else None))
        elif kind == "packagist":
            req = json.loads(text).get("require") or {}
            deps = [(n, v if re.fullmatch(r"v?\d+\.\d+\.\d+", str(v)) else None)
                    for n, v in req.items() if "/" in n]  # pin only exact versions, not ranges like ^10.0
        elif kind == "cargo":
            if not tomllib:
                raise HTTPException(400, "Cargo.toml needs Python 3.11+")
            deps = [(n, None) for n in (tomllib.loads(text).get("dependencies") or {})]
        elif kind == "go":
            deps = [(m.group(1), m.group(2)) for m in
                    re.finditer(r"^\s*(?:require\s+)?([\w.\-]+\.[\w.\-]+/\S+)\s+(v[\w.\-+]+)", text, re.M)]
        elif kind == "rubygems":
            deps = [(m.group(1), m.group(2)) for m in re.finditer(
                r"^\s*gem\s+['\"]([^'\"]+)['\"](?:\s*,\s*['\"]=?\s*(\d+\.\d+(?:\.\d+)*)['\"])?",
                text, re.M)]  # pin only exact versions, not '~> 7.0' ranges
        elif kind == "maven":
            for blk in re.findall(r"<dependency>(.*?)</dependency>", text, re.S):
                g = re.search(r"<groupId>\s*([^<\s]+)\s*</groupId>", blk)
                a = re.search(r"<artifactId>\s*([^<\s]+)\s*</artifactId>", blk)
                v = re.search(r"<version>\s*([^<\s]+)\s*</version>", blk)
                if g and a:  # ${property} versions are not pinned
                    ver = v.group(1) if v and re.fullmatch(r"[\w.\-]+", v.group(1)) else None
                    deps.append((f"{g.group(1)}:{a.group(1)}", ver))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Could not parse {kind} manifest: {e}")
    seen, out = set(), []
    for n, p in deps:
        if n not in seen:
            seen.add(n)
            out.append({"name": n, "eco": kind, "pinned": p})
    return out[:MAX_DEPS]


def short(name: str) -> str:
    return name.split("/")[-1].split(":")[-1]


# ---------- Tool 1: SerpApi official SDK (cached, budgeted, parallel-safe) ----------
def _serp_sync(engine, q, extra):
    res = serpapi.Client(api_key=os.getenv("SERPAPI_KEY", "")).search(engine=engine, q=q, **extra)
    return res.as_dict()


async def serp(client, sem, ctx, engine, q, *, fresh=False, **extra):
    key = hashlib.sha1(json.dumps([engine, q, extra], sort_keys=True).encode()).hexdigest()
    row = db.execute("SELECT v, ts FROM cache WHERE k=?", (key,)).fetchone()
    if not fresh and row and time.time() - row[1] < CACHE_TTL:
        ctx["cache_hits"] += 1
        return json.loads(row[0])
    if ctx["credits"] >= MAX_CREDITS:
        ctx["trace"].append(f"BUDGET: skipped {engine}: {q}")
        return {}
    ctx["credits"] += 1  # reserved before awaiting, so parallel tasks can't overspend
    async with sem:
        try:
            data = await asyncio.to_thread(_serp_sync, engine, q, extra)
        except Exception as e:
            ctx["trace"].append(f"ERROR {engine}: {q}: {e}")
            return {}
    db.execute("REPLACE INTO cache VALUES(?,?,?)", (key, json.dumps(data), time.time()))
    db.commit()
    return data


# ---------- Tool 2: official registries (free, no SerpApi credit) ----------
def days_since(ts):
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).days
    except Exception:
        return None


async def facts(client, d):
    """latest version, release age, deprecated/abandoned flag from the official registry"""
    eco, n = d["eco"], d["name"]
    try:
        if eco == "pypi":
            r = await client.get(f"https://pypi.org/pypi/{n}/json", timeout=15)
            if r.status_code != 200:
                return None
            j = r.json()
            files = j.get("urls") or []
            return {"latest": j["info"]["version"],
                    "days_since_release": days_since(files[0]["upload_time_iso_8601"]) if files else None,
                    "deprecated": any("Inactive" in c for c in j["info"].get("classifiers", []))}
        if eco == "rubygems":
            r = await client.get(f"https://rubygems.org/api/v1/gems/{n}.json", timeout=15)
            if r.status_code != 200:
                return None
            j = r.json()
            return {"latest": j["version"], "days_since_release": days_since(j.get("version_created_at")),
                    "deprecated": False}
        if eco == "packagist":
            r = await client.get(f"https://packagist.org/packages/{n}.json", timeout=15)
            if r.status_code != 200:
                return None
            p = r.json()["package"]
            vs = {k: v for k, v in p["versions"].items() if not k.startswith("dev-") and not k.endswith("-dev")}
            stable = {k: v for k, v in vs.items() if not re.search(r"alpha|beta|rc|dev|preview", k, re.I)} or vs
            if not stable:
                return None
            best = max(stable, key=lambda k: [int(x) for x in re.findall(r"\d+", k)[:4]])
            v = stable[best]
            return {"latest": str(v["version"]).lstrip("v"), "days_since_release": days_since(v.get("time")),
                    "deprecated": bool(p.get("abandoned"))}
        # npm, cargo, go, maven via Google's deps.dev
        r = await client.get(f"https://api.deps.dev/v3/systems/{DEPSDEV[eco]}/packages/{quote(n, safe='')}",
                             timeout=20)
        if r.status_code != 200:
            return None
        vs = r.json().get("versions", [])
        v = next((x for x in vs if x.get("isDefault")), None) or (vs[-1] if vs else None)
        if not v:
            return None
        return {"latest": v["versionKey"]["version"], "days_since_release": days_since(v.get("publishedAt")),
                "deprecated": bool(v.get("isDeprecated"))}
    except Exception:
        return None


async def osv(client, d, version):
    """known vulnerabilities from OSV.dev (open source vulnerability database)"""
    if not version:
        return []
    try:
        r = await client.post("https://api.osv.dev/v1/query", timeout=20, json={
            "package": {"name": d["name"], "ecosystem": OSV_ECO[d["eco"]]},
            "version": version.lstrip("v") if d["eco"] in ("go", "packagist") else version})
        return r.json().get("vulns", []) if r.status_code == 200 else []
    except Exception:
        return []


def risk_score(f, news_hits, vulns) -> int:
    s = min(40, 20 * news_hits) + min(60, 30 * vulns)
    if f:
        dd = f["days_since_release"]
        s += 0 if dd is None else 40 if dd > 730 else 20 if dd > 365 else 0
        s += 40 if f["deprecated"] else 0
    return s


def level(s):
    return "high" if s >= 60 else "medium" if s >= 30 else "low"


# ---------- LLM: Gemini (free, default) or Anthropic (optional) ----------
def _parse_json(text: str):
    text = re.sub(r"```(json)?", "", text).strip()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)  # fall back to the first {...} block
        if m:
            return json.loads(m.group(0))
        raise HTTPException(502, "LLM did not return valid JSON")


async def ask(ctx, system, user):
    global llm
    if LLM_PROVIDER == "anthropic":
        from anthropic import AsyncAnthropic  # only needed for this provider
        llm = llm or AsyncAnthropic()
        m = await llm.messages.create(model=MODEL, max_tokens=2000, system=system,
                                      messages=[{"role": "user", "content": user}])
        ctx["tokens_in"] += m.usage.input_tokens
        ctx["tokens_out"] += m.usage.output_tokens
        return _parse_json(m.content[0].text)

    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        raise HTTPException(500, "GEMINI_API_KEY missing (free key: aistudio.google.com)")
    body = {"systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 4096,
                                 "temperature": 0.2}}
    async with httpx.AsyncClient() as c:
        try:
            r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                             headers={"x-goog-api-key": key}, json=body, timeout=60)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Gemini request failed: {e}")
    if r.status_code == 429:
        raise HTTPException(503, "Gemini rate limit reached. Wait a minute and retry.")
    if r.status_code != 200:
        raise HTTPException(502, f"Gemini error {r.status_code}: {r.text[:200]}")
    j = r.json()
    try:
        text = "".join(p.get("text", "") for p in j["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError):
        raise HTTPException(502, "Gemini returned no content (maybe blocked). Try again.")
    u = j.get("usageMetadata", {})
    ctx["tokens_in"] += u.get("promptTokenCount", 0)
    ctx["tokens_out"] += u.get("candidatesTokenCount", 0)
    return _parse_json(text)


def norm(s: str) -> str:
    return re.sub(r"\W+", " ", s.lower()).strip()


class _DocText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "nav", "header", "footer", "svg", "noscript"}:
            self.skip_depth += 1
        elif not self.skip_depth and tag in {"p", "li", "h1", "h2", "h3", "pre"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "header", "footer", "svg", "noscript"} and self.skip_depth:
            self.skip_depth -= 1
        elif not self.skip_depth and tag in {"p", "li", "h1", "h2", "h3", "pre"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)


def official_doc_excerpt(html: str, max_chars=1400):
    parser = _DocText()
    parser.feed(html)
    blocks = [re.sub(r"\s+", " ", block).strip() for block in "".join(parser.parts).splitlines()]
    blocks = [block for block in blocks if len(block) > 35]
    relevant = re.compile(
        r"\b(async|await|concurren|worker|request|io.bound|cpu.bound|wsgi|asgi|"
        r"performance|benchmark|validation|serializ|automatic|background task)\b", re.I)
    selected, size = [], 0
    for block in blocks:
        if relevant.search(block) and block not in selected:
            if selected and size + len(block) > max_chars:
                break
            selected.append(block)
            size += len(block)
    return " ".join(selected)


def display_sources(sources):
    visible = []
    for source in sources:
        link = source.get("link", "")
        title = source.get("title") or link
        if link and link not in title:
            title = f"{title} — {link}"
        visible.append({key: value for key, value in source.items() if key != "snippet"} | {"title": title})
    return visible


async def fetch_official_docs(client, docs):
    async def fetch(doc):
        try:
            response = await client.get(doc["link"], timeout=20, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            return {**doc, "snippet": "", "error": str(exc)}
        if urlparse(str(response.url)).hostname != urlparse(doc["link"]).hostname:
            return {**doc, "snippet": "", "error": "Official documentation redirected to an unexpected host"}
        return {**doc, "snippet": official_doc_excerpt(response.text)}

    return await asyncio.gather(*(fetch(doc) for doc in docs))


def source_authority(link: str, question: str):
    parsed = urlparse(link)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if parsed.scheme != "https" or not host:
        return None
    labels = host.split(".")
    if (host.endswith((".gov", ".gov.uk", ".gov.in", ".edu", ".edu.au", ".int"))
            or host in {"who.int", "un.org", "europa.eu", "iso.org", "w3.org", "ietf.org"}):
        return "Official / primary"
    ignored = {"about", "after", "before", "best", "does", "explain", "find", "from",
               "give", "help", "how", "into", "latest", "more", "most", "need", "please",
               "should", "tell", "that", "their", "there", "these", "this", "through",
               "using", "what", "when", "where", "which", "while", "with", "would"}
    terms = {t for t in re.findall(r"[a-z0-9]+", question.lower()) if len(t) >= 4 and t not in ignored}
    host_terms = set(labels[:-1])
    if any(term in host_terms or any(len(term) >= 5 and term in label for label in host_terms)
           for term in terms) and host not in {"github.com", "medium.com", "wikipedia.org"}:
        return "Official / primary"
    if any(host == trusted or host.endswith("." + trusted) for trusted in REPUTABLE_SOURCE_HOSTS):
        return "Reputable secondary"
    return None


def new_ctx():
    return {"credits": 0, "cache_hits": 0, "tokens_in": 0, "tokens_out": 0, "trace": []}


# ---------- Compare engine (used by /compare and by audit auto_compare) ----------
async def run_compare(client, sem, ctx, a, b, use_case, eco="pypi"):
    framework_compare = eco == "pypi" and {short(a).casefold(), short(b).casefold()} == {"fastapi", "flask"}
    query = f"{short(a)} vs {short(b)} {LABEL[eco]} {use_case}"
    fa, fb, web = await asyncio.gather(
        facts(client, {"name": a.lower() if eco == "pypi" else a, "eco": eco}),
        facts(client, {"name": b.lower() if eco == "pypi" else b, "eco": eco}),
        fetch_official_docs(client, FASTAPI_FLASK_DOCS) if framework_compare else
        serp(client, sem, ctx, "google", query, num=6))
    src = {}
    if framework_compare:
        for doc in web:
            if doc["snippet"]:
                sid = f"S{len(src) + 1}"
                src[sid] = {"id": sid, "title": doc["title"], "link": doc["link"],
                            "date": "Retrieved " + datetime.now(timezone.utc).date().isoformat(),
                            "snippet": doc["snippet"]}
    else:
        for o in (web.get("organic_results") or [])[:5]:
            sid = f"S{len(src) + 1}"
            src[sid] = {"id": sid, "title": o.get("title", ""), "link": o.get("link"),
                        "date": o.get("date"), "snippet": o.get("snippet", "")}
    if not src and not framework_compare:
        return {"error": "no search results"}
    grounded_sources = [s for s in src.values() if s["snippet"]]
    packed = "\n".join(f"[{s['id']}] {s['title']} | {s['snippet']}" for s in grounded_sources)
    if not packed:
        return {"verdict": {"winner": "", "reason": "The official documentation could not be reached, "
                            "so I can't make a current evidence-based comparison. The official links are "
                            "included below; retry after the documentation sites are reachable.",
                            "flips_if": "", "confidence": "low"},
                "registry_facts": {a: fa, b: fb}, "claims": [], "rejected_claims": 0,
                "sources": display_sources(
                    [{"id": f"S{i}", "title": doc["title"], "link": doc["link"], "date": None}
                     for i, doc in enumerate(FASTAPI_FLASK_DOCS, 1)])}
    out = await ask(ctx,
                    'Return ONLY JSON: {"claims":[{"lib":"","text":"","source_id":"S1","quote":""}],'
                    '"verdict":{"winner":"","reason":"","flips_if":"","confidence":"low|medium|high"}}. '
                    "Use only the given sources and registry facts. quote must be copied word-for-word "
                    "from that source's snippet. flips_if = when the other library is the better pick. "
                    "For FastAPI-versus-Flask comparisons, answer the trade-offs directly and give a "
                    "conditional recommendation for the stated use case. FastAPI is the likely fit when "
                    "many concurrent I/O-bound requests and async-first APIs are central; Flask remains "
                    "reasonable when simplicity, existing Flask expertise, or synchronous workloads matter. "
                    "Explain that async does not make CPU-bound work faster and avoid unsupported universal "
                    "speed/RPS claims. Use only the supplied official documentation excerpts.",
                    f"Ecosystem: {LABEL[eco]}\nUse case: {use_case}\nA={a} facts={json.dumps(fa)}\n"
                    f"B={b} facts={json.dumps(fb)}\nSources:\n{packed}")
    claims = out.get("claims", [])
    kept = []
    grounded_ids = {s["id"] for s in grounded_sources}
    for c in claims:  # grounding check: quote must really exist in the source
        s = src.get(c.get("source_id"))
        if (s and c.get("source_id") in grounded_ids and c.get("quote")
                and norm(c["quote"]) in norm(s["title"] + " " + s["snippet"])):
            c["link"] = s["link"]
            kept.append(c)
    verdict = out.get("verdict", {})
    if claims and len(kept) / len(claims) < 0.6:
        verdict["confidence"] = "low"  # too many unsupported claims
    return {"verdict": verdict, "registry_facts": {a: fa, b: fb}, "claims": kept,
            "rejected_claims": len(claims) - len(kept), "sources": display_sources(src.values())}


@app.post("/compare")
async def compare(req: CompareReq):
    if req.ecosystem not in OSV_ECO:
        raise HTTPException(400, f"ecosystem must be one of {list(OSV_ECO)}")
    needs_search = (req.ecosystem != "pypi"
                    or {short(req.lib_a).casefold(), short(req.lib_b).casefold()} != {"fastapi", "flask"})
    if needs_search:
        if not os.getenv("SERPAPI_KEY"):
            raise HTTPException(500, "SERPAPI_KEY missing")
        require_serpapi()
    ctx = new_ctx()
    async with httpx.AsyncClient() as client:
        res = await run_compare(client, asyncio.Semaphore(5), ctx, req.lib_a.strip(),
                                req.lib_b.strip(), req.use_case, req.ecosystem)
    res["cost"] = {k: ctx[k] for k in ("credits", "cache_hits", "tokens_in", "tokens_out")}
    return res


@app.post("/ask")
async def answer_question(req: AskReq):
    question = req.question.strip()
    if not question or len(question) > 2000:
        raise HTTPException(400, "Question must contain 1 to 2000 characters")
    if not os.getenv("SERPAPI_KEY"):
        raise HTTPException(500, "SERPAPI_KEY missing")
    require_serpapi()

    ctx = new_ctx()
    async with httpx.AsyncClient() as client:
        results = await serp(client, asyncio.Semaphore(5), ctx, "google", question, fresh=True, num=10)

    sources = []
    for result in results.get("organic_results") or []:
        link = result.get("link", "")
        authority = source_authority(link, question)
        if not authority:
            continue
        sources.append({
            "id": f"S{len(sources) + 1}",
            "title": result.get("title", ""),
            "link": link,
            "date": result.get("date"),
            "snippet": result.get("snippet", ""),
            "authority": authority,
        })
    sources.sort(key=lambda source: source["authority"] != "Official / primary")
    sources = sources[:8]
    retrieved_at = datetime.now(timezone.utc).isoformat()
    grounded_sources = [source for source in sources if source["snippet"]]
    if not grounded_sources:
        return {
            "claims": [],
            "confidence": "low",
            "message": "I couldn't find current official or recognized reputable sources with verifiable excerpts, so I can't provide a sourced answer.",
            "sources": display_sources(sources),
            "retrieved_at": retrieved_at,
        }

    packed = "\n".join(
        f"[{source['id']}] {source['authority']} | {source['title']} | "
        f"{source['link']} | Published: {source['date'] or 'date not provided'} | {source['snippet']}"
        for source in grounded_sources
    )
    out = await ask(
        ctx,
        'Return ONLY JSON: {"claims":[{"text":"","citations":[{"source_id":"S1","quote":""}]}],'
        '"confidence":"low|medium|high"}. Answer the user\'s question using only the provided sources. '
        "Prefer official or primary sources; use reputable secondary sources only when needed. "
        "Every factual claim must have at least one citation whose quote is copied word-for-word from "
        "that source's snippet. Do not use any outside knowledge, invent facts, dates, statistics, or URLs, "
        "or claim something is current when the sources do not establish it. If sources do not support an "
        "answer, return an empty claims array and low confidence. Preserve the user's language.",
        f"Question: {question}\nCurrent UTC date: {retrieved_at}\nSources:\n{packed}",
    )
    source_by_id = {source["id"]: source for source in grounded_sources}
    claims = []
    for claim in out.get("claims", []):
        citations = []
        for citation in claim.get("citations", []):
            source = source_by_id.get(citation.get("source_id"))
            quote = citation.get("quote", "")
            if source and quote and norm(quote) in norm(source["snippet"]):
                citations.append({"source_id": source["id"], "quote": quote})
        if citations and claim.get("text"):
            claims.append({"text": claim["text"], "citations": citations})
    confidence = out.get("confidence", "low")
    if not claims or len(claims) < len(out.get("claims", [])):
        confidence = "low"
    return {
        "claims": claims,
        "confidence": confidence,
        "message": "" if claims else "The available sources did not support a verifiable answer.",
        "sources": display_sources(sources),
        "retrieved_at": retrieved_at,
    }


@app.get("/")
def root():
    return {"name": "Dependency Doctor", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {"ok": True, "ecosystems": list(OSV_ECO), "llm": f"{LLM_PROVIDER}:{MODEL}",
            "serpapi_key_set": bool(os.getenv("SERPAPI_KEY")),
            "llm_key_set": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
            if LLM_PROVIDER == "gemini" else bool(os.getenv("ANTHROPIC_API_KEY"))}


# ---------- Main audit pipeline ----------
@app.post("/audit")
async def audit(req: AuditReq):
    if not os.getenv("SERPAPI_KEY"):
        raise HTTPException(500, "SERPAPI_KEY missing")
    require_serpapi()
    deps_in = parse_manifest(req.manifest, req.manifest_type)
    if not deps_in:
        raise HTTPException(400, "No dependencies found")
    ctx, ev = new_ctx(), {}

    def add_ev(dep, kind, title, link=None, date=None, snippet=""):
        eid = f"E{len(ev) + 1}"
        ev[eid] = {"id": eid, "dep": dep, "kind": kind, "title": title, "link": link,
                   "date": date, "snippet": snippet[:200]}
        return eid

    async with httpx.AsyncClient() as client:
        sem = asyncio.Semaphore(5)

        # Stage 1 - cheap triage for ALL deps: registry facts + OSV (free) + one Google News search each
        async def triage(d):
            n, eco = d["name"], d["eco"]
            f, news = await asyncio.gather(
                facts(client, d),
                serp(client, sem, ctx, "google_news",
                     f"{short(n)} {LABEL[eco]} library deprecated OR vulnerability OR abandoned"))
            version = d["pinned"] or (f["latest"] if f else None)
            vulns = await osv(client, d, version)
            hits = []
            for it in (news.get("news_results") or [])[:5]:
                if RISK_WORDS.search(f"{it.get('title', '')} {it.get('snippet', '')}"):
                    hits.append(add_ev(n, "news", it.get("title", ""), it.get("link"), it.get("date"),
                                       it.get("snippet", "")))
            for v in vulns[:3]:
                hits.append(add_ev(n, "vulnerability", f"{v.get('id')}: {v.get('summary', '')[:120]}",
                                   f"https://osv.dev/vulnerability/{v.get('id')}", v.get("published")))
            s = risk_score(f, len(hits) - min(3, len(vulns)), len(vulns))
            return {"name": n, "ecosystem": eco, "version_checked": version, "facts": f, "risk": s,
                    "level": level(s), "vulnerabilities": [v.get("id") for v in vulns[:5]],
                    "evidence": hits[:5]}

        ctx["trace"].append(f"TRIAGE {len(deps_in)} dependencies (registry + OSV + Google News)")
        deps = await asyncio.gather(*(triage(d) for d in deps_in))

        # Stage 2 - deep dive only for the riskiest: job demand + alternatives
        risky = sorted([d for d in deps if d["risk"] >= 30], key=lambda d: -d["risk"])[:DEEP_K]
        ctx["trace"].append(f"DEEP DIVE on {[d['name'] for d in risky]}")

        async def deep(d):
            sn, label = short(d["name"]), LABEL[d["ecosystem"]]
            jobs, alts, trends = await asyncio.gather(
                serp(client, sem, ctx, "google_jobs", f"{sn} developer"),
                serp(client, sem, ctx, "google", f"best alternative to {sn} {label} {req.goal}", num=5),
                serp(client, sem, ctx, "google_trends", f"{sn} {label.split()[0]}",
                     data_type="TIMESERIES", date="today 12-m"))
            pts = [(p.get("values") or [{}])[0].get("extracted_value")
                   for p in (trends.get("interest_over_time") or {}).get("timeline_data") or []]
            pts = [v for v in pts if isinstance(v, (int, float))]
            if len(pts) >= 8:  # compare first quarter vs last quarter of the year
                q = len(pts) // 4
                first, last = sum(pts[:q]) / q, sum(pts[-q:]) / q
                t = "rising" if last > first * 1.15 else "falling" if last < first * 0.85 else "stable"
                d["evidence"].append(add_ev(d["name"], "trend",
                                            f"Google search interest is {t} over 12 months ({first:.0f} -> {last:.0f})"))
            n_jobs = len(jobs.get("jobs_results") or [])
            d["evidence"].append(add_ev(d["name"], "jobs", f"{n_jobs} job postings (first page) mention {sn}"))
            for o in (alts.get("organic_results") or [])[:3]:
                d["evidence"].append(add_ev(d["name"], "alternatives", o.get("title", ""), o.get("link"),
                                            o.get("date"), o.get("snippet", "")))

        await asyncio.gather(*(deep(d) for d in risky))

    # Stage 3 - one LLM call for the action plan, only over risky deps
    plan = []
    if risky:
        brief = [{"name": d["name"], "ecosystem": d["ecosystem"], "version_checked": d["version_checked"],
                  "facts": d["facts"], "risk": d["risk"], "evidence": [ev[e] for e in d["evidence"]]}
                 for d in risky]
        ctx["trace"].append(f"PLAN with {LLM_PROVIDER}:{MODEL}")
        out = await ask(ctx,
                        'Return ONLY JSON: {"actions":[{"name":"","action":"keep|update|replace|monitor",'
                        '"reason":"","alternative":"","evidence_ids":["E1"]}]}. Use only the given evidence. '
                        "Never recommend replace without evidence ids. Alternatives must be in the same ecosystem.",
                        f"Project goal: {req.goal or 'general'}\nDependencies: {json.dumps(brief)}")
        # Stage 4 - grounding check: drop fake evidence ids, downgrade unsupported replacements
        for a in out.get("actions", []):
            ok = [e for e in a.get("evidence_ids", []) if e in ev and ev[e]["dep"] == a.get("name")]
            a["evidence_ids"] = ok
            if a.get("action") == "replace" and not ok:
                a["action"], a["reason"] = "monitor", "Downgraded: no source evidence. " + a.get("reason", "")
            plan.append(a)

    # Optional: compare the top "replace" library with its suggested alternative
    comparison = None
    if req.auto_compare:
        pick = next((a for a in plan if a.get("action") == "replace" and a.get("alternative")), None)
        if pick:
            eco = next((d["ecosystem"] for d in deps if d["name"] == pick["name"]), deps[0]["ecosystem"])
            ctx["trace"].append(f"COMPARE {pick['name']} vs {pick['alternative']}")
            async with httpx.AsyncClient() as c2:
                comparison = await run_compare(c2, asyncio.Semaphore(5), ctx, pick["name"],
                                               pick["alternative"], req.goal or "general purpose project", eco)

    # Memory - what changed since the last audit of the same dependency set
    pid = hashlib.sha1(",".join(sorted(d["name"] for d in deps)).encode()).hexdigest()
    prev = db.execute("SELECT levels FROM audits WHERE project=? ORDER BY ts DESC LIMIT 1", (pid,)).fetchone()
    now_levels = {d["name"]: d["level"] for d in deps}
    changed = None
    if prev:
        old = json.loads(prev[0])
        changed = {n: f"{old.get(n, 'new')} -> {l}" for n, l in now_levels.items() if old.get(n) != l}
    db.execute("INSERT INTO audits(project, ts, levels) VALUES(?,?,?)", (pid, time.time(), json.dumps(now_levels)))
    db.commit()

    return {"ecosystem": deps_in[0]["eco"],
            "summary": {l: sum(1 for d in deps if d["level"] == l) for l in ("high", "medium", "low")},
            "dependencies": deps, "action_plan": plan, "comparison": comparison, "evidence": ev,
            "changed_since_last_audit": changed,
            "cost": {"serpapi_credits": ctx["credits"], "cache_hits": ctx["cache_hits"],
                     "tokens_in": ctx["tokens_in"], "tokens_out": ctx["tokens_out"]},
            "trace": ctx["trace"]}