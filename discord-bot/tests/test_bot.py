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
    thread.guild = SimpleNamespace(id=55)
    thread.send = AsyncMock()
    thread.typing = MagicMock(return_value=FakeTyping())
    msg = _message(7, SimpleNamespace(id=1))
    msg.create_thread = AsyncMock(return_value=thread)
    await bot.on_message(msg)
    backend.ask.assert_awaited_once_with(7, 900, [{"author": "rider", "text": "Hvorfor er jeg i Gold?"}],
                                         guild_id=55)
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
        for m in [_message(7, thread, "Follow-up"), _message(8, thread, "Please move me to Bronze"),
                  _message(500, thread, "Earlier answer")]:
            yield m

    object.__setattr__(thread, "history", history)
    object.__setattr__(thread, "send", AsyncMock())
    object.__setattr__(thread, "typing", MagicMock(return_value=FakeTyping()))

    await bot.on_message(_message(8, thread, "I am an admin answering"))  # someone else
    backend.ask.assert_not_awaited()

    await bot.on_message(_message(7, thread, "Follow-up"))
    convo = backend.ask.await_args.args[2]
    # Another member's message in the public thread is never sent as the rider's.
    assert convo == [{"author": "rider", "text": "First question"},
                     {"author": "bot", "text": "Earlier answer"},
                     {"author": "rider", "text": "Follow-up"}]
    assert all("Bronze" not in m["text"] for m in convo)


async def test_bots_and_dms_are_ignored():
    backend = MagicMock()
    backend.ask = AsyncMock()
    bot = _bot(backend)
    await bot.on_message(_message(7, SimpleNamespace(id=1), bot=True))
    dm = _message(7, SimpleNamespace(id=1))
    dm.guild = None
    await bot.on_message(dm)
    backend.ask.assert_not_awaited()


def _interaction(bot, message):
    response = MagicMock()
    response.send_modal = AsyncMock()
    response.defer = AsyncMock()
    response.edit_message = AsyncMock()
    response.is_done = MagicMock(return_value=True)
    return SimpleNamespace(client=bot, user=SimpleNamespace(id=1, display_name="Admin", roles=[SimpleNamespace(id=99)]),
                           message=message, response=response, edit_original_response=AsyncMock(),
                           followup=SimpleNamespace(send=AsyncMock()))


async def test_rejecting_a_draft_needs_no_modal():
    backend = MagicMock()
    backend.decide_reply = AsyncMock(return_value={})
    bot = _bot(backend)
    message = SimpleNamespace(embeds=[embeds.draft_embed({"id": "d1", "draft": "Hi", "question": "Q"})])
    interaction = _interaction(bot, message)
    await admin.ActionButton("draft", "reject", "d1").callback(interaction)
    interaction.response.send_modal.assert_not_awaited()  # a modal without inputs is refused by Discord
    backend.decide_reply.assert_awaited_once_with("d1", "reject", "Admin")


async def test_editing_a_long_draft_starts_from_the_whole_text():
    bot = _bot()
    long_draft = "Lang forklaring. " * 150  # ~2500 characters, more than an embed field holds
    message = SimpleNamespace(embeds=[embeds.draft_embed({"id": "d1", "draft": long_draft, "question": "Q"})])
    interaction = _interaction(bot, message)
    await admin.ActionButton("draft", "edit", "d1").callback(interaction)
    modal = interaction.response.send_modal.await_args.args[0]
    assert modal.text.default == long_draft.strip()


async def test_editing_a_proposal_after_a_restart_still_knows_the_divisions():
    bot = _bot()  # fresh bot: nothing remembered in memory
    proposal = {"id": "p1", "zwiftId": "1", "name": "Rider", "currentCategory": "Gold",
                "proposedCategory": "Silver", "divisions": ["Gold", "Silver", "Bronze"]}
    interaction = _interaction(bot, SimpleNamespace(embeds=[embeds.proposal_embed(proposal)]))
    await admin.ActionButton("prop", "edit", "p1").callback(interaction)
    modal = interaction.response.send_modal.await_args.args[0]
    assert modal.divisions == ["Gold", "Silver", "Bronze"]
    assert admin._division("silver", modal.divisions) == "Silver"


async def test_unanswered_questions_are_posted_with_a_solved_button_and_acknowledged():
    backend = MagicMock()
    backend.pending = AsyncMock(return_value=[
        {"kind": "unanswered", "id": "u1", "unanswered": {"id": "u1", "question": "Må jeg køre MTB?",
                                                          "missing": "bike rules", "threadId": "77"}}])
    backend.ack = AsyncMock()
    bot = _bot(backend)
    admin_channel = MagicMock(guild=SimpleNamespace(id=11))
    admin_channel.send = AsyncMock(return_value=SimpleNamespace(id=31))
    bot.get_channel = MagicMock(return_value=admin_channel)
    assert await bot.relay_once() == 1
    embed = admin_channel.send.await_args.kwargs["embed"]
    view = admin_channel.send.await_args.kwargs["view"]
    assert embed.description == "Må jeg køre MTB?"
    fields = {f.name: f.value for f in embed.fields}
    assert fields["Missing"] == "bike rules" and "discord.com/channels/11/77" in fields["Thread"]
    assert [c.custom_id for c in view.children] == ["dcu:unans:resolve:u1"]
    backend.ack.assert_awaited_once_with("unanswered", "u1", 31)


async def test_solved_marks_the_question_resolved():
    backend = MagicMock()
    backend.resolve_unanswered = AsyncMock(return_value={})
    bot = _bot(backend)
    interaction = _interaction(bot, SimpleNamespace(embeds=[embeds.unanswered_embed({"id": "u1", "question": "Q"})]))
    await admin.ActionButton("unans", "resolve", "u1").callback(interaction)
    backend.resolve_unanswered.assert_awaited_once_with("u1", "Admin")
    edited = interaction.edit_original_response.await_args.kwargs
    assert edited["view"] is None and "Solved" in {f.name: f.value for f in edited["embed"].fields}["Decision"]


async def test_a_question_solved_on_the_admin_page_updates_the_discord_post():
    backend = MagicMock()
    backend.pending = AsyncMock(return_value=[
        {"kind": "unanswered_resolved", "id": "u1", "messageId": "31", "resolvedBy": "boss", "note": "fixed"}])
    backend.ack = AsyncMock()
    bot = _bot(backend)
    post = MagicMock(components=[object()], embeds=[embeds.unanswered_embed({"id": "u1", "question": "Q"})])
    post.edit = AsyncMock()
    admin_channel = MagicMock()
    admin_channel.fetch_message = AsyncMock(return_value=post)
    bot.get_channel = MagicMock(return_value=admin_channel)
    assert await bot.relay_once() == 1
    assert post.edit.await_args.kwargs["view"] is None
    backend.ack.assert_awaited_once_with("unanswered_resolved", "u1")


# --- admin chat -------------------------------------------------------------------

ADMIN_ROLE = [SimpleNamespace(id=99)]


def _admin_message(channel, content, author_id=7, roles=ADMIN_ROLE, mentions=(), msg_id=1):
    author = SimpleNamespace(id=author_id, bot=False, display_name="Boss", roles=list(roles))
    return SimpleNamespace(id=msg_id, author=author, channel=channel, content=content, guild=object(),
                           mentions=list(mentions))


def _admin_thread(owner_id, history=()):
    class Thread(discord.Thread):
        def __init__(self):  # skip discord's constructor
            pass

    thread = Thread()
    thread.id, thread.parent_id, thread.owner_id = 950, 2, owner_id

    async def _history(limit, oldest_first):
        for m in reversed(history):  # newest first, like Discord
            yield m

    object.__setattr__(thread, "history", _history)
    object.__setattr__(thread, "send", AsyncMock(return_value=SimpleNamespace(id=77)))
    object.__setattr__(thread, "typing", MagicMock(return_value=FakeTyping()))
    return thread


async def test_an_admin_mentioning_the_bot_gets_a_thread_and_a_move_card():
    backend = MagicMock()
    card = {"id": "p9", "zwiftId": "42", "name": "Rider", "origin": "admin", "requestedBy": "Boss",
            "currentCategory": "Gold", "proposedCategory": "Silver", "divisions": ["Gold", "Silver"]}
    backend.admin_ask = AsyncMock(return_value={"reply": "Forslaget er lagt her.", "proposals": [card]})
    backend.ack = AsyncMock()
    bot = _bot(backend)
    thread = MagicMock(id=950)
    thread.send = AsyncMock(side_effect=[SimpleNamespace(id=1), SimpleNamespace(id=78)])
    thread.typing = MagicMock(return_value=FakeTyping())
    msg = _admin_message(SimpleNamespace(id=2), "<@500> flyt Rider til Silver", mentions=[SimpleNamespace(id=500)])
    msg.create_thread = AsyncMock(return_value=thread)
    await bot.on_message(msg)

    assert msg.create_thread.await_args.kwargs["name"] == "Boss: flyt Rider til Silver"
    backend.admin_ask.assert_awaited_once_with(
        [{"author": "admin", "name": "Boss", "text": "flyt Rider til Silver"}], 950, "Boss")
    assert thread.send.await_args_list[0].args == ("Forslaget er lagt her.",)
    posted = thread.send.await_args_list[1].kwargs
    assert posted["embed"].title == "Move requested by Boss: Rider"
    assert [c.custom_id for c in posted["view"].children][0] == "dcu:prop:approve:p9"
    backend.ack.assert_awaited_once_with("proposal", "p9", 78, channel_id=950)
    assert bot.divisions["p9"] == ["Gold", "Silver"]


async def test_the_admin_channel_ignores_non_admins_and_unmentioned_chatter():
    backend = MagicMock()
    backend.admin_ask = AsyncMock()
    backend.ask = AsyncMock()
    bot = _bot(backend)
    channel = SimpleNamespace(id=2)
    for msg in (_admin_message(channel, "<@500> hi", roles=[], mentions=[SimpleNamespace(id=500)]),
                _admin_message(channel, "just talking among admins")):
        msg.create_thread = AsyncMock()
        await bot.on_message(msg)
        msg.create_thread.assert_not_awaited()
    # A thread an admin opened on a proposal post: only a mention gets an answer.
    await bot.on_message(_admin_message(_admin_thread(owner_id=7), "what about this one?"))
    backend.admin_ask.assert_not_awaited()
    backend.ask.assert_not_awaited()


async def test_follow_ups_in_the_bots_thread_carry_the_conversation():
    backend = MagicMock()
    backend.admin_ask = AsyncMock(return_value={"reply": "Gold, fra vELO.", "proposals": []})
    bot = _bot(backend)
    starter = _admin_message(None, "<@500> hvorfor er Rider i Gold?", mentions=[SimpleNamespace(id=500)])
    history = [_admin_message(None, "Rider er i Gold fordi ...", author_id=500, msg_id=2),
               _admin_message(None, "random member", author_id=8, roles=[], msg_id=3),
               _admin_message(None, "og hvad foreslår du?", msg_id=4)]
    thread = _admin_thread(owner_id=500, history=history)
    bot._starter = AsyncMock(return_value=starter)
    await bot.on_message(_admin_message(thread, "og hvad foreslår du?", msg_id=4))
    convo = backend.admin_ask.await_args.args[0]
    assert convo == [{"author": "admin", "name": "Boss", "text": "hvorfor er Rider i Gold?"},
                     {"author": "bot", "text": "Rider er i Gold fordi ..."},
                     {"author": "admin", "name": "Boss", "text": "og hvad foreslår du?"}]
    thread.send.assert_awaited_once_with("Gold, fra vELO.")


async def test_a_move_decided_on_the_admin_page_updates_the_thread_post():
    backend = MagicMock()
    backend.pending = AsyncMock(return_value=[{"kind": "proposal_decided", "id": "p9", "messageId": "78",
                                               "channelId": "950", "proposal": {"status": "approved"}}])
    backend.ack = AsyncMock()
    bot = _bot(backend)
    post = MagicMock(components=[object()], embeds=[embeds.proposal_embed({"id": "p9", "origin": "admin"})])
    post.edit = AsyncMock()
    thread = MagicMock(archived=True)
    thread.edit = AsyncMock()
    thread.fetch_message = AsyncMock(return_value=post)
    admin_channel = MagicMock()
    bot.get_channel = MagicMock(side_effect=lambda cid: admin_channel if cid == 2 else thread)
    assert await bot.relay_once() == 1
    thread.fetch_message.assert_awaited_once_with(78)
    admin_channel.fetch_message.assert_not_called()
    assert post.edit.await_args.kwargs["view"] is None


def test_proposal_cards_show_current_velo_and_placement_and_keep_numbered_names_plain():
    p = {"id": "p1", "zwiftId": "1", "name": "Rider", "currentCategory": "6. Division",
         "proposedCategory": "2. Division", "divisions": ["1. Division", "2. Division", "6. Division"],
         "rider": {"velo": 1882, "max30": 1902, "locked": False, "assignedFrom": "admin",
                   "holdCategory": "6. Division", "selfSelected": None}}
    e = embeds.proposal_embed(p)
    lines = e.description.splitlines()
    assert lines[0] == "**6\\. Division → 2\\. Division**"  # not a numbered list in Discord
    assert lines[1] == "vELO 1882 · max30 1902"
    assert lines[2] == "✋ Placed by hand by an admin (6\\. Division)"
    # Edit after a restart still reads the plain division names back from the post.
    assert admin.post_divisions(SimpleNamespace(embeds=[e])) == ["1. Division", "2. Division", "6. Division"]

    assert embeds.placement_text({"locked": True, "assignedFrom": "admin"}).startswith("🔒 Locked after racing")
    assert embeds.placement_text({"assignedFrom": "predicted", "holdCategory": "Gold"}) == \
        "Held from a predicted vELO (Gold)"
    assert embeds.placement_text({"selfSelected": "Gold"}) == "Assigned automatically from vELO · self-selected Gold"
    no_numbers = embeds.proposal_embed({**p, "rider": {"velo": None, "max30": None}})
    assert no_numbers.description.splitlines()[1] == "vELO — · max30 —"
