from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from agents import TeamConfig
from agency import Agency, PersonalAgent, Registry
from agency import app as app_module

ROOT = Path(__file__).resolve().parents[2]


class AgencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.cfg = TeamConfig(
            root=ROOT,
            run_root=self.tmp / "team-runs",
            offline=True,
            approval_mode="deny",
            dry_run=True,
            max_cycles=2,
            parallel=False,
        )
        self.agency = Agency(
            config=self.cfg,
            registry=Registry(),
            memory_path=self.tmp / "memory.json",
            offline=True,
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_66_specialists_in_requested_range(self) -> None:
        n = len(self.agency.registry)
        self.assertEqual(n, 66)
        self.assertTrue(50 <= n <= 70)
        self.assertEqual(len(self.agency.list_agents()), 66)
        self.assertIn("design", self.agency.categories())
        self.assertEqual(len(self.agency.sales.roster), 56)
        self.assertEqual(len(self.agency.sales_agents(department="outreach")), 16)
        self.assertEqual(self.agency.stats()["sales_role_profiles"], 56)
        self.assertEqual(self.agency.registry.source, "https://github.com/Anas-Khan93/ai-agency-agents")

    def test_every_question_gets_non_empty_answer(self) -> None:
        questions = [
            "",
            "???",
            "2+2*5",
            "10/2",
            "aaj date kya hai",
            "time kya hai",
            "agency me kitne AI hain?",
            "jarvis ka malik kaun hai",
            "tum kya kar sakte ho",
            "kuch bhi random gibberish xyz qwerty",
            "Hindi me security audit ka plan batao",
            "github push gmail par aa raha hai kya",
        ]
        for q in questions:
            with self.subTest(q=q):
                res = self.agency.ask(q)
                self.assertIsInstance(res["answer"], str)
                self.assertTrue(res["answer"].strip(), f"empty answer for {q!r}")
                self.assertEqual(res["agent"], "Ari")
        self.assertEqual(self.agency.ask("2+2*5")["answer"], "ARISE, `2+2*5` = **12**.")

    def test_panel_uses_multiple_specialists(self) -> None:
        res = self.agency.consult("security testing audit chahiye")
        self.assertEqual(len(res["specialists"]), 5)
        self.assertIn("Panel", res["answer"])
        self.assertTrue(res["answer"].strip())

    def test_hire_and_memory(self) -> None:
        spec = self.agency.list_agents()[0]
        hired = self.agency.hire(spec["id"], "brand guideline bana do")
        self.assertTrue(hired["ok"])
        self.assertIn(spec["name"], hired["answer"])
        self.assertTrue(self.agency.remember("ARISE ko chai pasand hai")["ok"])
        self.assertEqual(len(self.agency.history(5)), 1)  # hire ne ek ask record kiya
        self.assertTrue(self.agency.forget()["ok"])

    def test_delegate_runs_earlier_level3_team(self) -> None:
        res = self.agency.delegate("INC-BOT ka safe audit karo")
        self.assertEqual(res["status"], "completed")
        self.assertTrue(res["final"])
        self.assertTrue(Path(res["report"]).exists())
        self.assertIn("agents/", res["integrated_from"])

    def test_http_endpoints_answer(self) -> None:
        old = app_module.AGENCY
        app_module.AGENCY = Agency(
            config=self.cfg,
            registry=Registry(),
            memory_path=self.tmp / "http-memory.json",
            offline=True,
        )
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
        httpd.daemon_threads = True
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as r:
                health = json.loads(r.read().decode("utf-8"))
            self.assertTrue(health["ok"])
            self.assertEqual(health["specialists"], 66)
            self.assertEqual(health["sales_role_profiles"], 56)

            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/ask",
                data=json.dumps({"question": "kuch bhi pucho", "panel": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read().decode("utf-8"))
            self.assertTrue(data["answer"].strip())
            self.assertEqual(data["agent"], "Ari")

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sales/departments", timeout=5) as r:
                depts = json.loads(r.read().decode("utf-8"))
            self.assertEqual(depts["count"], 56)
            self.assertEqual(len(depts["departments"]), 4)
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sales/agents?department=lead_generation", timeout=5) as r:
                role_list = json.loads(r.read().decode("utf-8"))
            self.assertEqual(role_list["count"], 16)

            sales_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/sales/run",
                data=json.dumps({"goal": "safe demo", "leads": [{"id": "x", "company": "Example", "email": "x@example.com", "title": "Owner", "source": "user", "intent": "interested", "email_opt_in": True}]}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(sales_req, timeout=5) as r:
                sales = json.loads(r.read().decode("utf-8"))
            self.assertEqual(sales["status"], "draft_ready")
            self.assertEqual(sales["external_actions_performed"], [])

            invalid_req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/sales/run",
                data=json.dumps({"leads": {"not": "an array"}}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(invalid_req, timeout=5)
            self.assertEqual(error.exception.code, 400)

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/manifest.webmanifest", timeout=5) as r:
                manifest = json.loads(r.read().decode("utf-8"))
                self.assertEqual(r.headers.get_content_type(), "application/manifest+json")
            self.assertEqual(manifest["display"], "standalone")
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/service-worker.js", timeout=5) as r:
                service_worker = r.read().decode("utf-8")
                self.assertEqual(r.headers.get("Service-Worker-Allowed"), "/")
            self.assertIn("/api/", service_worker)
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/icons/icon-192.png", timeout=5) as r:
                icon = r.read()
                self.assertEqual(r.headers.get_content_type(), "image/png")
            self.assertTrue(icon.startswith(bytes.fromhex("89504e470d0a1a0a")))

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as r:
                html = r.read().decode("utf-8")
            self.assertIn("Ari", html)
            self.assertIn("66", html)
            self.assertIn("Bolkar pucho", html)
            self.assertIn("manifest.webmanifest", html)
            self.assertIn("serviceWorker", html)
            self.assertIn('id="installApp"', html)
            self.assertIn("beforeinstallprompt", html)
            self.assertIn("Add to Home Screen", html)

            vercel_html = (ROOT / "agency" / "vercel" / "index.html").read_text(encoding="utf-8")
            self.assertIn('id="installApp"', vercel_html)
            self.assertIn("beforeinstallprompt", vercel_html)
            self.assertIn("Add to Home Screen", vercel_html)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)
            app_module.AGENCY = old


class PersonalAgentStandaloneTests(unittest.TestCase):
    def test_standalone_personal_agent(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            a = PersonalAgent(registry=Registry(), memory_path=Path(d) / "m.json", offline=True)
            self.assertTrue(a.ask("")["answer"].strip())
            self.assertTrue(a.ask("What is 7*8?")["answer"].strip())
            self.assertEqual(a.stats()["specialists_available"], 66)


if __name__ == "__main__":
    unittest.main()
