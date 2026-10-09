import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

import backend


class ManifestParserTests(unittest.TestCase):
    def test_detects_and_parses_pinned_python_dependencies(self):
        result = backend.parse_manifest("flask==3.0.0\nrequests>=2.0\n", "auto")

        self.assertEqual(
            result,
            [
                {"name": "flask", "eco": "pypi", "pinned": "3.0.0"},
                {"name": "requests", "eco": "pypi", "pinned": None},
            ],
        )

    def test_detects_npm_manifest_and_only_pins_exact_versions(self):
        result = backend.parse_manifest(
            '{"dependencies":{"react":"19.0.0","vite":"^6.0.0"}}'
        )

        self.assertEqual(
            result,
            [
                {"name": "react", "eco": "npm", "pinned": "19.0.0"},
                {"name": "vite", "eco": "npm", "pinned": None},
            ],
        )

    def test_rejects_invalid_json_manifest(self):
        with self.assertRaises(HTTPException) as error:
            backend.parse_manifest("{invalid", "auto")

        self.assertEqual(error.exception.status_code, 400)


class BackendEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport = httpx.ASGITransport(app=backend.app)
        self.client = httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_health_reports_supported_ecosystems(self):
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(len(response.json()["ecosystems"]), 7)

    async def test_ask_rejects_blank_questions(self):
        response = await self.client.post("/ask", json={"question": "  "})

        self.assertEqual(response.status_code, 400)

    async def test_search_endpoint_reports_missing_optional_sdk(self):
        with patch.object(backend, "serpapi", None), patch.dict(
            os.environ, {"SERPAPI_KEY": "test-key"}
        ):
            response = await self.client.post(
                "/ask", json={"question": "Find official FastAPI docs"}
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("SDK is not installed", response.json()["detail"])

    async def test_compare_rejects_unknown_ecosystems(self):
        response = await self.client.post(
            "/compare",
            json={"lib_a": "one", "lib_b": "two", "ecosystem": "unknown"},
        )

        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
