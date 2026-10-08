"""
Smoke test for Dependency Doctor.

1. Start the server in one terminal:   uvicorn backend:app --reload
2. Run this in a second terminal:      python smoke_test.py
   Extra npm test (uses ~6-10 more SerpApi credits):  python smoke_test.py --full
   Rust, Go, Java, Ruby, PHP + auto_compare (~25-40 credits):  python smoke_test.py --all

Uses only httpx (already installed). Prints a RESULT section at the end.
"""
import sys, json
import httpx

BASE = "http://127.0.0.1:8000"
FULL = "--full" in sys.argv
ALL = "--all" in sys.argv
warnings, passed = [], []


def ok(msg):
    passed.append(msg)
    print(f"  PASS  {msg}")


def warn(msg):
    warnings.append(msg)
    print(f"  WARN  {msg}")


def post(path, body, timeout=180):
    try:
        r = httpx.post(BASE + path, json=body, timeout=timeout)
    except httpx.HTTPError as e:
        warn(f"{path}: could not reach server ({e}). Is uvicorn running?")
        return None
    if r.status_code != 200:
        warn(f"{path}: HTTP {r.status_code}: {r.text[:300]}")
        return None
    return r.json()


def check_audit(name, data, expect_eco):
    if not data:
        return
    if data.get("ecosystem") == expect_eco:
        ok(f"{name}: ecosystem detected as {expect_eco}")
    else:
        warn(f"{name}: expected ecosystem {expect_eco}, got {data.get('ecosystem')}")
    deps = data.get("dependencies", [])
    if deps:
        ok(f"{name}: {len(deps)} dependencies parsed")
    else:
        warn(f"{name}: no dependencies returned")
    for d in deps:
        if not d.get("facts"):
            warn(f"{name}: no registry facts for '{d['name']}' (registry lookup failed?)")
    for t in data.get("trace", []):
        if t.startswith("ERROR"):
            warn(f"{name}: {t[:200]}")
        if t.startswith("BUDGET"):
            warn(f"{name}: credit cap reached -> {t[:120]}")
    plan = data.get("action_plan", [])
    risky = [d for d in deps if d["risk"] >= 30]
    if risky and not plan:
        warn(f"{name}: risky dependencies found but action_plan is empty (LLM step failed?)")
    for a in plan:
        if a.get("action") == "replace" and not a.get("evidence_ids"):
            warn(f"{name}: 'replace' without evidence for {a.get('name')}")
        if not a.get("evidence_ids"):
            warn(f"{name}: no evidence ids for {a.get('name')}")
    if plan:
        ok(f"{name}: action plan has {len(plan)} item(s)")
    c = data.get("cost", {})
    print(f"        cost: {c.get('serpapi_credits')} new SerpApi credits, "
          f"{c.get('cache_hits')} cache hits, tokens {c.get('tokens_in')}/{c.get('tokens_out')}")
    if risky and c.get("tokens_in", 0) == 0 and c.get("serpapi_credits", 0) >= 0 and not plan:
        warn(f"{name}: LLM used 0 tokens")


print("\n[1] /health")
try:
    h = httpx.get(BASE + "/health", timeout=15).json()
    ok(f"server up, model = {h.get('llm')}")
    if not h.get("serpapi_key_set"):
        warn("SERPAPI_KEY not set")
    if not h.get("llm_key_set"):
        warn("LLM key not set (GEMINI_API_KEY)")
except Exception as e:
    warn(f"/health failed: {e}. Start the server first: uvicorn backend:app --reload")
    print("\nRESULT")
    for w in warnings:
        print(" -", w)
    sys.exit(1)

print("\n[2] /audit  (python: flask==1.0, requests, numpy)")
a = post("/audit", {"manifest": "flask==1.0\nrequests\nnumpy", "goal": "small web API", "auto_compare": False})
check_audit("python audit", a, "pypi")

print("\n[3] /compare  (flask vs fastapi)")
c = post("/compare", {"lib_a": "flask", "lib_b": "fastapi", "ecosystem": "pypi", "use_case": "small API"})
if c:
    if c.get("error"):
        warn(f"compare: {c['error']}")
    else:
        v = c.get("verdict", {})
        if v.get("winner") and v.get("reason"):
            ok(f"compare verdict: winner = {v.get('winner')}, confidence = {v.get('confidence')}")
        else:
            warn("compare: verdict is missing winner or reason")
        if v.get("flips_if"):
            ok("compare: 'flips_if' present")
        else:
            warn("compare: 'flips_if' missing")
        kept, rej = len(c.get("claims", [])), c.get("rejected_claims", 0)
        print(f"        claims kept (quote verified): {kept}, rejected: {rej}")
        if kept == 0:
            warn("compare: no verified claims (LLM quotes did not match sources)")
        print(f"        cost: {c.get('cost')}")

if FULL:
    print("\n[4] /audit  (npm: express, lodash)  --full")
    n = post("/audit", {"manifest": json.dumps({"dependencies": {"express": "4.17.1", "lodash": "4.17.20"}}),
                        "goal": "web server"})
    check_audit("npm audit", n, "npm")

if ALL:
    CASES = [
        ("Rust (cargo)", "cargo",
         {"manifest": '[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\nrand = "0.7"',
          "goal": "cli tool"}),
        ("Go", "go",
         {"manifest": "module demo\n\ngo 1.21\n\nrequire (\n  github.com/gin-gonic/gin v1.6.3\n  github.com/gorilla/mux v1.8.0\n)",
          "goal": "web api"}),
        ("Java (maven)", "maven",
         {"manifest": "<project><dependencies><dependency><groupId>org.apache.logging.log4j</groupId>"
                      "<artifactId>log4j-core</artifactId><version>2.14.1</version></dependency>"
                      "<dependency><groupId>junit</groupId><artifactId>junit</artifactId>"
                      "<version>4.13.2</version></dependency></dependencies></project>",
          "goal": "backend service"}),
        ("Ruby (rubygems)", "rubygems",
         {"manifest": "source 'https://rubygems.org'\ngem 'rails'\ngem 'sinatra'", "goal": "web app"}),
        ("PHP (packagist)", "packagist",
         {"manifest": json.dumps({"require": {"laravel/framework": "^10.0", "guzzlehttp/guzzle": "^7.0"}}),
          "goal": "web app"}),
    ]
    for i, (cname, eco, body) in enumerate(CASES, start=5):
        print(f"\n[{i}] /audit  ({cname})  --all")
        res = post("/audit", body)
        check_audit(cname, res, eco)
        if res:
            for d in res.get("dependencies", []):
                f = d.get("facts") or {}
                print(f"        {d['name']}: latest {f.get('latest')}, risk {d['risk']} ({d['level']})")

    print("\n[10] auto_compare  (pycrypto is abandoned, should trigger replace + comparison)  --all")
    d = post("/audit", {"manifest": "pycrypto\nrequests", "goal": "encryption helper", "auto_compare": True})
    check_audit("auto_compare audit", d, "pypi")
    if d:
        actions = {a.get("name"): a.get("action") for a in d.get("action_plan", [])}
        print(f"        actions: {actions}")
        cmp_ = d.get("comparison")
        if cmp_ and not cmp_.get("error") and cmp_.get("verdict"):
            ok(f"auto_compare: comparison present, winner = {cmp_['verdict'].get('winner')}")
        elif "replace" in actions.values():
            warn("auto_compare: action was 'replace' but comparison is missing or empty")
        else:
            print("        (AI did not choose 'replace' this time, so no comparison. Not a bug.)")

print("\nRESULT")
print(f"  passed: {len(passed)}   warnings: {len(warnings)}")
for w in warnings:
    print(" -", w)
if not warnings:
    print("  No warnings. Backend looks good.")
print("\nNow check your SerpApi dashboard: 'Searches done this month' should have gone up a little.")