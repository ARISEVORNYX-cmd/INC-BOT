"""Regression tests for per-server level-up announcement routing."""
import asyncio
import os
import sys
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bot as botmod


class FakeChannel:
    def __init__(self, channel_id):
        self.id = channel_id
        self.mention = f"<#{channel_id}>"
        self.send = mock.AsyncMock()
        self.permissions_for = mock.Mock(return_value=types.SimpleNamespace(send_messages=True))


class FakeGuild:
    def __init__(self, guild_id, channels):
        self.id = guild_id
        self.me = object()
        self.channels = {channel.id: channel for channel in channels}

    def get_channel_or_thread(self, channel_id):
        return self.channels.get(int(channel_id))

    def get_channel(self, channel_id):
        return self.channels.get(int(channel_id))


class FakeResponse:
    def __init__(self):
        self.send_message = mock.AsyncMock()


class TestLevelUpChannel(unittest.TestCase):
    def _message(self, guild, source, xp=90):
        now = time.time()
        user = types.SimpleNamespace(id=42, bot=False, mention="<@42>")
        message = types.SimpleNamespace(guild=guild, channel=source, author=user)
        data = {str(guild.id): {str(user.id): {"xp": xp, "messages": 0, "last_xp": now - 120}}}
        return message, data

    def test_level_up_announcement_uses_configured_channel(self):
        source = FakeChannel(10)
        target = FakeChannel(11)
        guild = FakeGuild(100, [source, target])
        message, levels = self._message(guild, source)
        with mock.patch.object(botmod, "_levels", levels), \
             mock.patch.object(botmod, "_level_channels", {str(guild.id): target.id}), \
             mock.patch.object(botmod, "_save_levels"), \
             mock.patch.object(botmod.random, "randint", return_value=15):
            asyncio.run(botmod._award_xp(message))
        target.send.assert_awaited_once()
        source.send.assert_not_awaited()
        self.assertIn("Level 1", target.send.await_args.args[0])

    def test_unconfigured_level_up_stays_in_source_channel(self):
        source = FakeChannel(10)
        guild = FakeGuild(100, [source])
        message, levels = self._message(guild, source)
        with mock.patch.object(botmod, "_levels", levels), \
             mock.patch.object(botmod, "_level_channels", {}), \
             mock.patch.object(botmod, "_save_levels"), \
             mock.patch.object(botmod.random, "randint", return_value=15):
            asyncio.run(botmod._award_xp(message))
        source.send.assert_awaited_once()
        self.assertIn("Level 1", source.send.await_args.args[0])

    def test_configured_channel_failure_falls_back_to_source(self):
        source = FakeChannel(10)
        target = FakeChannel(11)
        target.send.side_effect = RuntimeError("no permission")
        guild = FakeGuild(100, [source, target])
        message, levels = self._message(guild, source)
        with mock.patch.object(botmod, "_levels", levels), \
             mock.patch.object(botmod, "_level_channels", {str(guild.id): target.id}), \
             mock.patch.object(botmod, "_save_levels"), \
             mock.patch.object(botmod.random, "randint", return_value=15):
            asyncio.run(botmod._award_xp(message))
        target.send.assert_awaited_once()
        source.send.assert_awaited_once()

    def test_mod_can_set_and_disable_level_channel(self):
        source = FakeChannel(10)
        target = FakeChannel(11)
        guild = FakeGuild(100, [source, target])
        user = types.SimpleNamespace(guild_permissions=types.SimpleNamespace(
            administrator=False, manage_guild=True, manage_messages=False,
            kick_members=False, ban_members=False
        ))
        interaction = types.SimpleNamespace(
            guild=guild, user=user, channel=source, response=FakeResponse()
        )
        settings = {}
        with mock.patch.object(botmod, "_level_channels", settings), \
             mock.patch.object(botmod, "_save_level_channels"):
            asyncio.run(botmod.levelchannel_cmd.callback(interaction, target))
            self.assertEqual(settings[str(guild.id)], target.id)
            off = botmod.app_commands.Choice(name="Off", value="off")
            asyncio.run(botmod.levelchannel_cmd.callback(interaction, None, off))
        self.assertNotIn(str(guild.id), settings)
        self.assertEqual(interaction.response.send_message.await_count, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
