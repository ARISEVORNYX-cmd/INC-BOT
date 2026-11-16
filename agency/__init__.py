"""INC AI Agency — Ari + 66 general profiles + 56 sales profiles + Level-3 team.

Quick use:
    from agency import Agency
    a = Agency()
    print(a.ask("kya kar sakte ho?")["answer"])
    print(len(a.list_agents()))          # 66
    print(a.delegate("Audit INC-BOT")["status"])
"""
from .agency import Agency
from .personal import PersonalAgent
from .registry import AgentSpec, Registry
from .sales import SalesAgency

__version__ = "1.0.0"
__all__ = ["Agency", "PersonalAgent", "Registry", "AgentSpec", "SalesAgency"]
