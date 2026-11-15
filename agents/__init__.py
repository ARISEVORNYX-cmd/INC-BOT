"""INC-BOT Level-3 Agent Team.

Portable, stdlib-only multi-agent runtime. Import `run_goal` from anywhere
(CLI, Discord bot, Jarvis, GitHub Actions) or use `python -m agents`.
"""
from .models import RunState, Task, TeamConfig
from .orchestrator import AgentTeam, run_goal
from .tools import Tool, ToolRegistry, build_registry

__version__ = "0.1.0"
__all__ = [
    "AgentTeam",
    "run_goal",
    "TeamConfig",
    "RunState",
    "Task",
    "Tool",
    "ToolRegistry",
    "build_registry",
]
