from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from agency.cli import main as cli_main
from agency.sales import SalesAgency


class SalesAgencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sales = SalesAgency()

    def test_four_departments_and_56_role_profiles(self) -> None:
        self.assertEqual(len(self.sales.roster), 56)
        counts = {d["id"]: d["agent_count"] for d in self.sales.departments()}
        self.assertEqual(counts, {
            "lead_generation": 16,
            "outreach": 16,
            "sales_calling": 12,
            "crm_operations": 12,
        })

    def test_vercel_companion_roster_matches_local_roster(self) -> None:
        path = Path(__file__).resolve().parents[1] / "vercel" / "api" / "sales-agents.json"
        vercel_agents = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual([a["id"] for a in vercel_agents], [a["id"] for a in self.sales.roster])

    def test_cli_lists_roles_and_runs_preview_from_user_json(self) -> None:
        lead = {
            "id": "cli-1", "company": "Example Co", "name": "Ari Test", "title": "Owner",
            "email": "cli@example.com", "source": "provided", "intent": "requested details",
            "email_opt_in": True,
        }
        with tempfile.TemporaryDirectory() as temp:
            leads_path = Path(temp) / "leads.json"
            leads_path.write_text(json.dumps([lead]), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                status = cli_main(["--sales", "Preview only", "--sales-leads", str(leads_path)])
        self.assertEqual(status, 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result["status"], "draft_ready")
        self.assertEqual(result["external_actions_performed"], [])

    def test_requires_lead_data_instead_of_inventing_or_scraping(self) -> None:
        result = self.sales.run("Find potential customers")
        self.assertEqual(result["status"], "needs_input")
        self.assertEqual(result["external_actions_performed"], [])
        self.assertIn("no Apollo/CRM/email/phone provider is connected", result["summary"])

    def test_consent_qualified_lead_gets_drafts_not_external_actions(self) -> None:
        lead = {
            "id": "lead-1",
            "company": "Example Co",
            "name": "Sam Example",
            "title": "Operations lead",
            "email": "sam@example.com",
            "phone": "+15550000000",
            "source": "user supplied",
            "intent": "exploring workflow automation",
            "email_opt_in": True,
            "phone_call_opt_in": False,
            "whatsapp_opt_in": False,
        }
        result = self.sales.run("Qualify this sample lead", [lead])
        self.assertEqual(result["status"], "draft_ready")
        self.assertEqual(result["counts"]["qualified"], 1)
        email = result["actions"]["outreach"][0]
        self.assertEqual(email["status"], "awaiting_human_review")
        self.assertFalse(email["sent"])
        call = result["actions"]["sales_calling"][0]
        self.assertEqual(call["status"], "blocked_no_explicit_call_opt_in")
        crm = result["actions"]["crm_operations"][0]
        self.assertFalse(crm["applied"])
        self.assertEqual(result["external_actions_performed"], [])
        self.assertTrue(result["human_approval_required"])

    def test_optout_blocks_outreach_call_and_crm_is_only_a_proposal(self) -> None:
        lead = {
            "id": "lead-opt-out",
            "company": "Example Co",
            "name": "Taylor",
            "title": "Buyer",
            "email": "taylor@example.com",
            "phone": "+15550000001",
            "source": "provided",
            "intent": "needs a demo",
            "email_opt_in": True,
            "phone_call_opt_in": True,
            "do_not_contact": True,
        }
        result = self.sales.run("Preview", [lead], channel="email")
        self.assertEqual(result["actions"]["outreach"][0]["status"], "blocked_opt_out")
        self.assertEqual(result["actions"]["sales_calling"][0]["status"], "blocked_opt_out")
        self.assertFalse(result["actions"]["crm_operations"][0]["applied"])

    def test_duplicates_and_invalid_rows_are_counted(self) -> None:
        a = {"id": "a", "email": "HELLO@example.com", "company": "A", "title": "Owner"}
        b = {"id": "b", "email": "hello@example.com", "company": "A", "title": "Owner"}
        result = self.sales.run("Deduplicate", [a, b, "bad row", {}])
        self.assertEqual(result["counts"]["valid_unique"], 1)
        self.assertEqual(result["counts"]["duplicates"], 1)
        self.assertEqual(result["counts"]["invalid_rows"], 2)

    def test_unqualified_lead_is_not_drafted_even_with_optin(self) -> None:
        result = self.sales.run("Review only", [{
            "id": "thin", "email": "new@example.com", "email_opt_in": True,
            "phone": "+15550000003", "phone_call_opt_in": True,
        }])
        self.assertFalse(result["lead_scores"][0]["qualified"])
        self.assertEqual(result["actions"]["outreach"][0]["status"], "blocked_insufficient_qualification")
        self.assertEqual(result["actions"]["sales_calling"][0]["status"], "blocked_insufficient_qualification")

    def test_call_script_requires_phone_optin_and_stays_unplaced(self) -> None:
        lead = {
            "id": "call-1", "company": "Example Co", "name": "Morgan", "title": "Owner",
            "phone": "+15550000004", "source": "user supplied", "intent": "asked for a call",
            "phone_call_opt_in": True,
        }
        result = self.sales.run("Prepare a call", [lead], channel="phone")
        action = result["actions"]["sales_calling"][0]
        self.assertEqual(action["status"], "awaiting_human_review")
        self.assertFalse(action["placed"])
        self.assertEqual(result["external_actions_performed"], [])

    def test_channel_optin_is_channel_specific(self) -> None:
        lead = {
            "id": "w1", "company": "Example", "name": "Alex", "email": "alex@example.com",
            "phone": "+15550000002", "title": "Founder", "source": "provided", "intent": "looking",
            "email_opt_in": False, "whatsapp_opt_in": True, "phone_call_opt_in": False,
        }
        wa = self.sales.run("Draft WA", [lead], channel="whatsapp")
        self.assertEqual(wa["actions"]["outreach"][0]["type"], "whatsapp_draft")
        self.assertEqual(wa["actions"]["outreach"][0]["status"], "awaiting_human_review")
        self.assertEqual(wa["actions"]["sales_calling"][0]["status"], "blocked_no_explicit_call_opt_in")


if __name__ == "__main__":
    unittest.main()
