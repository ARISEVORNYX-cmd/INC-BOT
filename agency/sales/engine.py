"""Consent-first sales operations agency (56 role profiles, 4 departments).

This is an offline-first planning/drafting engine. It can score user-supplied
prospects, draft outreach, prepare call scripts, and propose CRM patches. It
NEVER searches/enriches contacts, sends messages, places calls, creates events,
or writes to a CRM. Those operations need provider adapters, explicit consent,
and a separate human approval step.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
ROSTER_PATH = Path(__file__).with_name("roster.json")

DEPARTMENT_META = {
    "lead_generation": {
        "name": "Lead Generation",
        "purpose": "Research and qualify only user-supplied companies/leads; no scraping or invented contacts.",
    },
    "outreach": {
        "name": "Outreach Agents",
        "purpose": "Prepare opt-in, human-reviewed message drafts; never send them.",
    },
    "sales_calling": {
        "name": "Sales Calling",
        "purpose": "Prepare call briefs/scripts only for explicit opt-in; never place calls.",
    },
    "crm_operations": {
        "name": "CRM Operations",
        "purpose": "Validate records and propose CRM changes; never write to a CRM.",
    },
}


def _text(value: Any, limit: int = 500) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()[:limit]


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"yes", "true", "1", "opted-in", "opt_in"})


def _has_optout(lead: dict[str, Any]) -> bool:
    return _truthy(lead.get("do_not_contact")) or _truthy(lead.get("opted_out")) or _truthy(lead.get("unsubscribe"))


def _consented(lead: dict[str, Any], channel: str) -> bool:
    consent = lead.get("consent") if isinstance(lead.get("consent"), dict) else {}
    field = {"email": "email_opt_in", "whatsapp": "whatsapp_opt_in", "phone": "phone_call_opt_in"}[channel]
    return _truthy(lead.get(field)) or _truthy(consent.get(field))


def _lead_key(lead: dict[str, Any]) -> str:
    email = _text(lead.get("email"), 254).lower()
    if email:
        return "email:" + email
    company = _text(lead.get("company"), 160).lower()
    name = _text(lead.get("name") or lead.get("first_name"), 160).lower()
    if company or name:
        return "person:" + company + "|" + name
    return "row:" + str(uuid.uuid4())


def _score(lead: dict[str, Any]) -> tuple[int, list[str]]:
    score, reasons = 0, []
    if _text(lead.get("company")):
        score += 1; reasons.append("company supplied")
    if _text(lead.get("title") or lead.get("role")):
        score += 2; reasons.append("buyer role supplied")
    if _text(lead.get("source")):
        score += 1; reasons.append("source supplied")
    if _text(lead.get("intent") or lead.get("need")):
        score += 2; reasons.append("explicit need/intent supplied")
    if _text(lead.get("email")) or _text(lead.get("phone")):
        score += 1; reasons.append("contact field supplied")
    if any(_consented(lead, c) for c in ("email", "whatsapp", "phone")):
        score += 2; reasons.append("channel opt-in recorded")
    return score, reasons


class SalesAgency:
    """Directory + deterministic sales workflow preview for 56 sales role profiles."""

    def __init__(self, roster_path: Path | None = None) -> None:
        data = json.loads((roster_path or ROSTER_PATH).read_text(encoding="utf-8"))
        self.roster = list(data.get("agents") or [])
        self.by_id = {a["id"]: a for a in self.roster}
        self.counts = {k: sum(1 for a in self.roster if a["department"] == k) for k in DEPARTMENT_META}

    def departments(self) -> list[dict[str, Any]]:
        return [
            {"id": key, **meta, "agent_count": self.counts.get(key, 0)}
            for key, meta in DEPARTMENT_META.items()
        ]

    def list_agents(self, department: str | None = None, query: str | None = None) -> list[dict[str, Any]]:
        out = list(self.roster)
        if department:
            out = [a for a in out if a["department"] == department]
        if query:
            terms = [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2]
            out = [
                a for a in out
                if all(t in (a["name"] + " " + a["mission"] + " " + a["department"]).lower() for t in terms)
            ]
        return out

    def _used_agents(self) -> list[dict[str, str]]:
        selected = [
            "icp_research_analyst", "lead_score_analyst", "lead_data_validator",
            "email_personalization_writer", "consent_optout_guard", "followup_sequence_designer",
            "call_eligibility_verifier", "discovery_question_designer", "call_script_drafter",
            "crm_field_mapper", "lead_stage_recommender", "crm_permission_auditor",
        ]
        return [{"id": self.by_id[i]["id"], "name": self.by_id[i]["name"], "department": self.by_id[i]["department"]} for i in selected]

    def run(self, goal: str, leads: list[dict[str, Any]] | None = None, channel: str = "email") -> dict[str, Any]:
        goal = _text(goal, 1000) or "Plan a consent-first sales workflow"
        channel = str(channel or "email").lower()
        if channel not in {"email", "whatsapp", "phone"}:
            channel = "email"
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-sales-" + uuid.uuid4().hex[:6]
        pipeline = ["lead_generation", "outreach", "sales_calling", "crm_operations"]

        # No source integrations configured: explain the exact input needed rather than
        # scraping the internet or manufacturing a list of prospects.
        if leads is None:
            return {
                "run_id": run_id,
                "status": "needs_input",
                "goal": goal,
                "channel": channel,
                "pipeline": pipeline,
                "summary": "Sales plan ready. Supply a consented lead list or approved data connector to start qualification; no Apollo/CRM/email/phone provider is connected.",
                "required_input": {
                    "leads": "array of lead objects; useful fields: id, company, name, title, email, phone, source, intent, email_opt_in, whatsapp_opt_in, phone_call_opt_in, do_not_contact",
                    "consent": "set the channel-specific opt-in field to true only when you have a valid record of permission",
                },
                "actions": [],
                "external_actions_performed": [],
                "agents_available": len(self.roster),
                "agents_used": self._used_agents(),
                "human_approval_required": True,
                "safety": ["No lead search/enrichment", "No messages sent", "No calls placed", "No CRM writes", "No contact data stored"],
            }

        if not isinstance(leads, list):
            raise ValueError("leads must be an array of objects")
        if len(leads) > 500:
            raise ValueError("maximum 500 leads per preview run")

        unique: list[tuple[str, dict[str, Any]]] = []
        seen: set[str] = set()
        duplicate_count = 0
        invalid_count = 0
        for index, raw in enumerate(leads, start=1):
            if not isinstance(raw, dict):
                invalid_count += 1
                continue
            lead = dict(raw)
            if not any(_text(lead.get(field)) for field in ("id", "email", "company", "name", "first_name", "phone")):
                invalid_count += 1
                continue
            key = _lead_key(lead)
            if key in seen:
                duplicate_count += 1
                continue
            seen.add(key)
            ref = _text(lead.get("id"), 80) or f"lead-{index}"
            unique.append((ref, lead))

        qualified: list[dict[str, Any]] = []
        excluded: list[dict[str, Any]] = []
        outreach_actions: list[dict[str, Any]] = []
        call_actions: list[dict[str, Any]] = []
        crm_actions: list[dict[str, Any]] = []

        for ref, lead in unique:
            score, reasons = _score(lead)
            opted_out = _has_optout(lead)
            is_qualified = score >= 5 and not opted_out
            record = {
                "lead_ref": ref,
                "score": score,
                "score_max": 9,
                "qualified": is_qualified,
                "reasons": reasons,
                "do_not_contact": opted_out,
                "suggested_stage": "qualified" if is_qualified else ("do_not_contact" if opted_out else "needs_research"),
            }
            if is_qualified:
                qualified.append(record)
            else:
                excluded.append(record)

            safe_name = _text(lead.get("first_name") or lead.get("name"), 80).split(" ")[0] or "there"
            company = _text(lead.get("company"), 120) or "your team"
            need = _text(lead.get("intent") or lead.get("need"), 180)

            # Contacting is never automated. Draft only for the selected channel
            # and only when its own explicit opt-in is present.
            if opted_out:
                outreach_actions.append({"type": f"{channel}_outreach", "lead_ref": ref, "status": "blocked_opt_out", "sent": False})
            elif not is_qualified:
                outreach_actions.append({"type": f"{channel}_outreach", "lead_ref": ref, "status": "blocked_insufficient_qualification", "sent": False})
            elif channel == "email" and _text(lead.get("email")) and _consented(lead, "email"):
                need_line = f" I noticed you mentioned {need}." if need else ""
                outreach_actions.append({
                    "type": "email_draft",
                    "lead_ref": ref,
                    "status": "awaiting_human_review",
                    "to_present": True,
                    "subject": f"A quick idea for {company}",
                    "body": f"Hi {safe_name},\n\nI’m reaching out because {company} may be a fit for a conversation about [verified value proposition].{need_line}\n\nWould a short, no-pressure discussion be useful? If not, reply ‘no thanks’ and I won’t follow up.\n\n[Your name / company]",
                    "sent": False,
                })
            elif channel == "whatsapp" and _text(lead.get("phone")) and _consented(lead, "whatsapp"):
                outreach_actions.append({
                    "type": "whatsapp_draft",
                    "lead_ref": ref,
                    "status": "awaiting_human_review",
                    "body": f"Hi {safe_name}, this is [your name] from [company]. You opted in to hear about [topic]. Is a short overview useful? Reply STOP any time.",
                    "sent": False,
                })
            elif channel == "phone":
                outreach_actions.append({
                    "type": "phone_handoff",
                    "lead_ref": ref,
                    "status": "see_sales_calling_stage",
                    "placed": False,
                })
            else:
                outreach_actions.append({"type": f"{channel}_outreach", "lead_ref": ref, "status": "blocked_no_explicit_channel_opt_in", "sent": False})

            if opted_out:
                call_actions.append({
                    "type": "call_script",
                    "lead_ref": ref,
                    "status": "blocked_opt_out",
                    "placed": False,
                })
            elif not is_qualified:
                call_actions.append({
                    "type": "call_script",
                    "lead_ref": ref,
                    "status": "blocked_insufficient_qualification",
                    "placed": False,
                })
            elif _text(lead.get("phone")) and _consented(lead, "phone"):
                call_actions.append({
                    "type": "call_script_draft",
                    "lead_ref": ref,
                    "status": "awaiting_human_review",
                    "placed": False,
                    "script": (
                        f"Hi {safe_name}, this is [your name] from [company]. You opted in to a call. "
                        f"Is now a good time? I’d like to understand {need or 'whether this is relevant to your team'}. "
                        "If not, I can stop here or arrange another time."
                    ),
                })
            else:
                call_actions.append({
                    "type": "call_script",
                    "lead_ref": ref,
                    "status": "blocked_opt_out" if opted_out else "blocked_no_explicit_call_opt_in",
                    "placed": False,
                })

            # CRM updates are proposals only. Never connect or write to a live CRM here.
            crm_actions.append({
                "type": "crm_patch_proposal",
                "lead_ref": ref,
                "status": "awaiting_human_review",
                "patch": {"pipeline_stage_suggestion": record["suggested_stage"], "score": score},
                "applied": False,
            })

        action_count = len(outreach_actions) + len(call_actions) + len(crm_actions)
        return {
            "run_id": run_id,
            "status": "draft_ready",
            "goal": goal,
            "channel": channel,
            "pipeline": pipeline,
            "summary": (
                f"Reviewed {len(unique)} supplied lead(s): {len(qualified)} qualified, "
                f"{len(excluded)} excluded/needs research, {duplicate_count} duplicate(s). "
                "Outreach/call/CRM output is draft-only; nothing was sent, called, or written."
            ),
            "counts": {
                "input": len(leads),
                "valid_unique": len(unique),
                "qualified": len(qualified),
                "excluded_or_needs_research": len(excluded),
                "duplicates": duplicate_count,
                "invalid_rows": invalid_count,
                "draft_actions": action_count,
            },
            "lead_scores": qualified + excluded,
            "actions": {
                "outreach": outreach_actions,
                "sales_calling": call_actions,
                "crm_operations": crm_actions,
            },
            "external_actions_performed": [],
            "agents_available": len(self.roster),
            "agents_used": self._used_agents(),
            "human_approval_required": True,
            "safety": [
                "Used only the leads provided in this request; no web scraping or third-party enrichment.",
                "Requires explicit channel-specific opt-in and stops for do-not-contact/opt-out.",
                "No email/WhatsApp sent and no phone call placed.",
                "CRM updates are proposals only and were not applied.",
                "Raw lead rows are not persisted by this workflow.",
            ],
        }
