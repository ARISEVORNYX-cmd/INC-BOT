"""Optional Discord adapter: exposes the same agent team as `/team`.

Enabled only when `AGENT_TEAM_ENABLED=1` in bot/.env. Runs in safe mode by
default: risky tools are denied, so the command never edits the repo or sends
messages unless you explicitly change the policy.

discord.py is imported lazily so the standalone `agents` package stays usable
in a plain Python environment (CI, CLI, Jarvis) without Discord installed.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from ..models import TeamConfig
from ..orchestrator import AgentTeam


def _allowed(interaction: Any, owner_id: int) -> bool:
    user = getattr(interaction, "user", None)
    if owner_id and getattr(user, "id", 0) == owner_id:
        return True
    perms = getattr(user, "guild_permissions", None)
    return bool(perms and getattr(perms, "administrator", False))


def register_agent_team(bot: Any, owner_id: int = 0) -> None:
    """Idempotently register `/team` on an existing commands.Bot tree."""
    try:
        import discord
        from discord import app_commands
    except ImportError as exc:  # pragma: no cover - only hit without discord.py
        raise RuntimeError("discord.py is required for the /team adapter") from exc

    if getattr(bot, "_inc_agent_team_registered", False):
        return
    try:
        existing = {c.name for c in bot.tree.get_commands()}
    except Exception:
        existing = set()
    if "team" in existing:
        bot._inc_agent_team_registered = True
        return
    bot._inc_agent_team_registered = True

    @bot.tree.command(name="team", description="Delegate a goal to the Level-3 AI agent team (owner/admin)")
    @app_commands.describe(
        goal="What should the agent team accomplish?",
        offline="Run the deterministic offline demo instead of Gemini",
    )
    async def team_cmd(interaction: discord.Interaction, goal: str, offline: bool = False) -> None:
        if not _allowed(interaction, owner_id):
            await interaction.response.send_message("🔒 `/team` is owner/admin only.", ephemeral=True)
            return
        goal = (goal or "").strip()[:500]
        if not goal:
            await interaction.response.send_message("❌ Give a goal.", ephemeral=True)
            return

        await interaction.response.defer(thinking=True, ephemeral=True)
        cfg = TeamConfig(offline=offline, approval_mode="deny", dry_run=False, max_cycles=2, parallel=False)
        team = AgentTeam(cfg)
        try:
            state = await asyncio.to_thread(team.run, goal)
        except Exception as exc:
            await interaction.followup.send(
                f"❌ Agent team failed: `{type(exc).__name__}: {exc}`", ephemeral=True
            )
            return

        pending = len(state.pending_approvals)
        embed = discord.Embed(
            title="🤖 Agent Team finished",
            color=0x2ed573 if state.status == "completed" else 0xff9f43,
            description=(state.final or "(no summary)")[:1000],
        )
        embed.add_field(name="Run", value=f"`{state.run_id}`", inline=True)
        embed.add_field(name="Status", value=f"`{state.status}`", inline=True)
        embed.add_field(name="Model", value=f"`{team.llm.name}`", inline=True)
        embed.add_field(name="Tasks", value=str(len(state.tasks)), inline=True)
        embed.add_field(name="Pending approvals", value=str(pending), inline=True)
        embed.add_field(name="Mode", value="`deny` (safe)", inline=True)
        embed.set_footer(text="INC-BOT • agents/ • full report attached")

        report = Path(state.run_dir) / "report.md"
        kwargs: dict[str, Any] = {"embed": embed, "ephemeral": True}
        if report.exists():
            kwargs["file"] = discord.File(report, filename=f"agent-team-{state.run_id}.md")
        await interaction.followup.send(**kwargs)

    # Keep a reference so the closure survives GC in some discord.py versions.
    bot._inc_agent_team_command = team_cmd
