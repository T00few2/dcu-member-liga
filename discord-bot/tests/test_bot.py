"""Bot logic with mocked Discord objects and a mocked backend."""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bot import admin, embeds  # noqa: E402
from bot.client import DcuBot, split_message  # noqa: E402
from bot.config import Config, load  # noqa: E402

CFG = Config(token="t", help_channel_id=1, admin_channel_id=2, admin_role_id=99,
             backend_url="https://api.example", shared_secret="s")


def _bot(backend=None):
    bot = DcuBot(CFG, backend=backend or MagicMock())
    bot._connection.user = SimpleNamespace(id=500)  # the bot's own user
    return bot


def test_config_needs_every_variable():
    with pytest.raises(SystemExit):
        load({"DISCORD_BOT_TOKEN": "t"})
    cfg = load({"DISCORD_BOT_TOKEN": "t", "HELP_CHANNEL_ID": "1", "ADMIN_CHANNEL_ID": "2",
                "ADMIN_ROLE_ID": "3", "BACKEND_URL": "https://x/", "BOT_SHARED_SECRET": "s"})
    assert cfg.backend_url == "https://x" and cfg.admin_role_id == 3 and cfg.poll_seconds == 60


def test_long_replies_are_split():
    parts = split_message("a" * 4000)
    assert len(parts) == 3 and all(len(p) <= 1900 for p in parts)
    assert split_message("") == []


def test_only_admins_may_decide():
    assert admin.is_admin(SimpleNamespace(roles=[SimpleNamespace(id=99)]), 99)
    assert not admin.is_admin(SimpleNamespace(roles=[SimpleNamespace(id=1)]), 99)
    assert not admin.is_admin(SimpleNamespace(), 99)  # a DM user has no roles


def test_proposal_embed_shows_the_appeal():
    e = embeds.proposal_embed({
        "id": "p1", "zwiftId": "42", "name": "Rider", "origin": "appeal", "currentCategory": "Gold",
        "proposedCategory": "Silver", "suggestedCategory": "Gold", "requestedCategory": "Silver",
        "riderStatement": "Injured", "flags": ["appeal_not_supported"], "predictedVelo": 1080,
        "source": "strava", "stravaRides": {"activityCount": 12, "indoorCount": 4, "outdoorCount": 8, "days": 90},
    })
    assert e.title == "Appeal: Rider" and "Gold → Silver" in e.description and "4 indoor, 8 outdoor" in e.description
    fields = {f.name: f.value for f in e.fields}
    assert fields["Rider asks for Silver"] == "Injured"
    assert fields["Flags"] == "the numbers do not support the request"


async def test_buttons_carry_a_persistent_id():  # views need a running loop
    ids = [item.item.custom_id for item in admin.proposal_view("abc123").children]
    assert ids == ["dcu:prop:approve:abc123", "dcu:prop:edit:abc123", "dcu:prop:reject:abc123"]
    assert admin.ActionButton.__discord_ui_compiled_template__.match("dcu:draft:send:abc123")


async def test_relay_posts_delivers_and_acknowledges_each_item_once():
    backend = MagicMock()
    backend.pending = AsyncMock(return_value=[
        {"kind": "proposal", "id": "p1", "proposal": {"id": "p1", "zwiftId": "42", "divisions": ["Gold", "Silver"]}},
        {"kind": "draft", "id": "d1", "draft": {"id": "d1", "question": "?", "draft": "Hej"}},
        {"kind": "reply", "id": "d0", "threadId": "777", "text": "Final answer"},
        {"kind": "outcome", "id": "p0", "threadId": "777", "text": "Decided"},
    ])
    backend.ack = AsyncMock()
    bot = _bot(backend)
    admin_channel = MagicMock()
    admin_channel.send = AsyncMock(side_effect=[SimpleNamespace(id=11), SimpleNamespace(id=12)])
    thread = MagicMock(archived=False)
    thread.send = AsyncMock()
    bot.get_channel = MagicMock(side_effect=lambda cid: admin_channel if cid == 2 else thread)

    assert await bot.relay_once() == 4
    assert [c.args for c in backend.ack.await_args_list] == [
        ("proposal", "p1", 11), ("draft", "d1", 12), ("reply", "d0"), ("outcome", "p0")]
    assert [c.args[0] for c in thread.send.await_args_list] == ["Final answer", "Decided"]
    assert bot.divisions["p1"] == ["Gold", "Silver"]


async def test_one_failing_item_does_not_block_the_rest():
    backend = MagicMock()
    backend.pending = AsyncMock(return_value=[
        {"kind": "reply", "id": "d0", "threadId": "777", "text": "x"},
        {"kind": "draft", "id": "d1", "draft": {"id": "d1"}},
    ])
    backend.ack = AsyncMock()
    bot = _bot(backend)
    admin_channel = MagicMock()
    admin_channel.send = AsyncMock(return_value=SimpleNamespace(id=12))
    bot.get_channel = MagicMock(side_effect=lambda cid: admin_channel if cid == 2 else None)
    bot.fetch_channel = AsyncMock(side_effect=discord.NotFound(MagicMock(status=404), "gone"))
    assert await bot.relay_once() == 1
    backend.ack.assert_awaited_once_with("draft", "d1", 12)  # the failed reply is retried next round


def _message(author_id, channel, content="Hvorfor er jeg i Gold?", bot=False):
    author = SimpleNamespace(id=author_id, bot=bot, display_name="Rider")
    return SimpleNamespace(author=author, channel=channel, content=content, guild=object())


class FakeTyping:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


async def test_a_new_help_message_opens_a_thread_and_answers():
    backend = MagicMock()
    backend.ask = AsyncMock(return_value={"reply": "Tak – en admin svarer snart."})
    bot = _bot(backend)
    thread = MagicMock(id=900)
    thread.send = AsyncMock()
    thread.typing = MagicMock(return_value=FakeTyping())
    msg = _message(7, SimpleNamespace(id=1))
    msg.create_thread = AsyncMock(return_value=thread)
    await bot.on_message(msg)
    backend.ask.assert_awaited_once_with(7, 900, [{"author": "rider", "text": "Hvorfor er jeg i Gold?"}])
    thread.send.assert_awaited_once_with("Tak – en admin svarer snart.")


async def test_only_the_rider_who_asked_gets_answers_in_the_thread():
    backend = MagicMock()
    backend.ask = AsyncMock(return_value={"reply": "ok"})
    bot = _bot(backend)

    class Thread(discord.Thread):
        def __init__(self):  # skip discord's constructor
            pass

    thread = Thread()
    thread.id, thread.parent_id = 900, 1
    starter = _message(7, None, "First question")
    bot._starter = AsyncMock(return_value=starter)

    async def history(limit, oldest_first):
        for m in [_message(7, thread, "Follow-up"), _message(500, thread, "Earlier answer")]:
            yield m

    object.__setattr__(thread, "history", history)
    object.__setattr__(thread, "send", AsyncMock())
    object.__setattr__(thread, "typing", MagicMock(return_value=FakeTyping()))

    await bot.on_message(_message(8, thread, "I am an admin answering"))  # someone else
    backend.ask.assert_not_awaited()

    await bot.on_message(_message(7, thread, "Follow-up"))
    convo = backend.ask.await_args.args[2]
    assert convo == [{"author": "rider", "text": "First question"},
                     {"author": "bot", "text": "Earlier answer"},
                     {"author": "rider", "text": "Follow-up"}]


async def test_bots_and_dms_are_ignored():
    backend = MagicMock()
    backend.ask = AsyncMock()
    bot = _bot(backend)
    await bot.on_message(_message(7, SimpleNamespace(id=1), bot=True))
    dm = _message(7, SimpleNamespace(id=1))
    dm.guild = None
    await bot.on_message(dm)
    backend.ask.assert_not_awaited()
