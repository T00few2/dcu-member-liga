"""The bot: help-channel threads and the admin-channel relay.

Help channel: a rider's new message opens a thread; each message from that rider in the
thread goes to the backend (`/bot/ask`) with the thread history, and the bot posts the
answer (or a holding message while an admin approves the draft). Other people writing
in the thread (admins answering by hand) are ignored.

Admin channel: every `poll_seconds` the bot asks the backend what to post or deliver
(`/bot/pending`: proposals, reply drafts and questions the bot could not answer) and
acknowledges each item (`/bot/ack`) so nothing is sent twice.

Admin chat: an admin who mentions the bot in the admin channel gets a thread where they can
talk with the division agent (`/bot/admin/ask`): why a rider is in a division, which division
the agent suggests, and "move X to Y". A move comes back as a proposal, posted in the thread
with Approve / Edit / Reject; nothing changes before an admin clicks Approve. In its own
threads the bot answers every admin message; elsewhere only when mentioned. Only members
with the admin role are answered.
"""
from __future__ import annotations

import asyncio
import logging
import re

import discord

from bot import admin, embeds
from bot.backend import Backend, BackendError
from bot.config import Config

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 20
MAX_MESSAGE = 1900
SORRY = ("Der skete en fejl – en admin kigger på det. / Something went wrong – an admin will take a look.")


def split_message(text: str) -> list[str]:
    """Discord messages are limited to 2000 characters."""
    text = (text or "").strip()
    parts = []
    while len(text) > MAX_MESSAGE:
        cut = text.rfind("\n", 0, MAX_MESSAGE)
        cut = cut if cut > MAX_MESSAGE // 2 else MAX_MESSAGE
        parts.append(text[:cut])
        text = text[cut:].lstrip()
    return parts + ([text] if text else [])


def thread_name(message: discord.Message, text: str | None = None) -> str:
    base = ((message.content if text is None else text) or "Spørgsmål").strip().splitlines() or ["Spørgsmål"]
    return f"{message.author.display_name}: {base[0]}"[:95]


def strip_mentions(text: str, user_id: int | None) -> str:
    """The admin's words without the bot's @mention."""
    if user_id is None:
        return (text or "").strip()
    return re.sub(rf"<@!?{user_id}>", "", text or "").strip()


class DcuBot(discord.Client):
    def __init__(self, config: Config, backend: Backend | None = None):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)
        self.config = config
        self.backend = backend or Backend(config.backend_url, config.shared_secret)
        self.divisions: dict[str, list[str]] = {}  # proposal id -> division names (for Edit)
        self.known_divisions: list[str] = []
        self._poller: asyncio.Task | None = None

    async def setup_hook(self) -> None:
        self.add_dynamic_items(admin.ActionButton)
        self._poller = asyncio.create_task(self._poll_forever())

    async def close(self) -> None:
        if self._poller:
            self._poller.cancel()
        await self.backend.close()
        await super().close()

    async def on_ready(self) -> None:
        logger.info("Logged in as %s; help channel %s, admin channel %s",
                    self.user, self.config.help_channel_id, self.config.admin_channel_id)

    # --- help channel ---------------------------------------------------------

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return
        channel = message.channel
        if await self._admin_chat(message):
            return
        if getattr(channel, "id", None) == self.config.help_channel_id:
            thread = await message.create_thread(name=thread_name(message), auto_archive_duration=1440)
            await self.answer(thread, message.author, [message])
            return
        if isinstance(channel, discord.Thread) and channel.parent_id == self.config.help_channel_id:
            starter = await self._starter(channel)
            if starter is None or starter.author.id != message.author.id:
                return  # only the rider who asked; admins may answer by hand
            history = [m async for m in channel.history(limit=HISTORY_LIMIT, oldest_first=False)]
            history.reverse()
            await self.answer(channel, message.author, [starter, *history])

    async def _starter(self, thread: discord.Thread) -> discord.Message | None:
        try:
            parent = thread.parent or await self.fetch_channel(thread.parent_id)
            return await parent.fetch_message(thread.id)  # a thread from a message shares its id
        except (discord.NotFound, discord.Forbidden, discord.HTTPException):
            return None

    async def answer(self, thread: discord.abc.Messageable, rider: discord.abc.User,
                     messages: list[discord.Message]) -> None:
        # Only the asking rider's own words and the bot's answers: help threads are public, so
        # anything another member writes there must never be passed off as the rider's.
        bot_id = getattr(self.user, "id", None)
        convo = []
        for m in messages:
            if not m.content:
                continue
            if m.author.id == rider.id:
                convo.append({"author": "rider", "text": m.content})
            elif m.author.id == bot_id:
                convo.append({"author": "bot", "text": m.content})
        try:
            async with thread.typing():
                result = await self.backend.ask(rider.id, thread.id, convo,
                                                guild_id=getattr(getattr(thread, "guild", None), "id", None))
            reply = result.get("reply") or ""
        except BackendError as e:
            logger.warning("ask failed: %s", e.message)
            reply = SORRY
        for part in split_message(reply):
            await thread.send(part)

    # --- admin chat -------------------------------------------------------------

    def _mentions_me(self, message: discord.Message) -> bool:
        bot_id = getattr(self.user, "id", None)
        return any(getattr(u, "id", None) == bot_id for u in getattr(message, "mentions", None) or [])

    async def _admin_chat(self, message: discord.Message) -> bool:
        """Handle an admin talking to the bot in the admin channel. True when the message was
        in the admin channel or one of its threads (handled or deliberately ignored)."""
        channel = message.channel
        admin_channel = self.config.admin_channel_id
        in_channel = getattr(channel, "id", None) == admin_channel
        in_thread = isinstance(channel, discord.Thread) and channel.parent_id == admin_channel
        if not (in_channel or in_thread):
            return False
        if not admin.is_admin(message.author, self.config.admin_role_id):
            return True
        if in_channel:
            if not self._mentions_me(message):
                return True  # admins talking among themselves
            text = strip_mentions(message.content, getattr(self.user, "id", None))
            thread = await message.create_thread(name=thread_name(message, text or "Agent"),
                                                 auto_archive_duration=1440)
            await self.admin_answer(thread, message.author, [message])
            return True
        # In a thread: the bot's own threads get every admin message; others only a mention.
        if channel.owner_id != getattr(self.user, "id", None) and not self._mentions_me(message):
            return True
        history = [m async for m in channel.history(limit=HISTORY_LIMIT, oldest_first=False)]
        history.reverse()
        if not any(getattr(m, "id", None) == getattr(message, "id", None) for m in history):
            history.append(message)
        starter = await self._starter(channel) if channel.owner_id == getattr(self.user, "id", None) else None
        await self.admin_answer(channel, message.author, ([starter] if starter else []) + history)
        return True

    async def _wrote_as_admin(self, message: discord.Message, guild, known: dict[int, bool]) -> bool:
        """Whether a thread message was written by an admin. Messages read from the history carry a
        plain user without roles when the member is not cached (the bot has no members intent), so
        the role is then read from Discord."""
        author = message.author
        if author.id in known:
            return known[author.id]
        if getattr(author, "roles", None) is not None:  # a member: the roles are right there
            known[author.id] = admin.is_admin(author, self.config.admin_role_id)
            return known[author.id]
        try:
            member = await guild.fetch_member(author.id)
        except (AttributeError, discord.HTTPException) as exc:  # no guild, left the server, Discord down
            logger.warning("could not read the roles of %s: %s", author.id, exc)
            return False
        known[author.id] = admin.is_admin(member, self.config.admin_role_id)
        return known[author.id]

    async def admin_answer(self, thread: discord.abc.Messageable, asker: discord.abc.User,
                           messages: list[discord.Message]) -> None:
        bot_id = getattr(self.user, "id", None)
        # `asker` was checked on the live message. Other authors are looked up once per turn.
        admins: dict[int, bool] = {asker.id: True}
        convo = []
        for m in messages:
            if m.author.id == bot_id:
                if m.content:
                    convo.append({"author": "bot", "text": m.content})
            elif await self._wrote_as_admin(m, getattr(thread, "guild", None), admins):
                text = strip_mentions(m.content, bot_id)
                if text:
                    convo.append({"author": "admin", "name": admin.who(m.author), "text": text})
        if not convo:
            return
        try:
            async with thread.typing():
                result = await self.backend.admin_ask(convo, thread.id, admin.who(asker))
        except BackendError as e:
            logger.warning("admin ask failed: %s", e.message)
            await thread.send(f"Det gik galt / Something went wrong: {e.message}")
            return
        for part in split_message(result.get("reply") or ""):
            await thread.send(part)
        for proposal in result.get("proposals") or []:
            pid = str(proposal.get("id"))
            if proposal.get("divisions"):
                self.divisions[pid] = proposal["divisions"]
                self.known_divisions = proposal["divisions"]
            msg = await thread.send(embed=embeds.proposal_embed(proposal), view=admin.proposal_view(pid))
            try:
                await self.backend.ack("proposal", pid, msg.id, channel_id=thread.id)
            except BackendError as e:  # the relay posts it in the channel after a few minutes
                logger.warning("ack of admin-chat proposal %s failed: %s", pid, e.message)

    # --- admin channel relay ----------------------------------------------------

    async def _poll_forever(self) -> None:
        await self.wait_until_ready()
        while not self.is_closed():
            try:
                await self.relay_once()
            except Exception as exc:  # keep polling whatever happens
                logger.warning("relay failed: %s", exc)
            await asyncio.sleep(self.config.poll_seconds)

    async def relay_once(self) -> int:
        """Post / deliver everything pending once. Returns how many items were handled."""
        admin_channel = self.get_channel(self.config.admin_channel_id) or \
            await self.fetch_channel(self.config.admin_channel_id)
        done = 0
        for item in await self.backend.pending():
            try:
                if await self._handle(item, admin_channel):
                    done += 1
            except Exception as exc:  # one bad item never blocks the rest; retried next round
                logger.warning("relay item %s/%s failed: %s", item.get("kind"), item.get("id"), exc)
        return done

    async def _handle(self, item: dict, admin_channel) -> bool:
        kind, item_id = item.get("kind"), str(item.get("id"))
        if kind == "proposal":
            proposal = item.get("proposal") or {}
            if proposal.get("divisions"):
                self.divisions[item_id] = proposal["divisions"]
                self.known_divisions = proposal["divisions"]
            msg = await admin_channel.send(embed=embeds.proposal_embed(proposal), view=admin.proposal_view(item_id))
            await self.backend.ack(kind, item_id, msg.id)
        elif kind == "draft":
            msg = await admin_channel.send(embed=embeds.draft_embed(item.get("draft") or {}),
                                           view=admin.draft_view(item_id))
            await self.backend.ack(kind, item_id, msg.id)
        elif kind in ("reply", "outcome"):
            thread = self.get_channel(int(item["threadId"])) or await self.fetch_channel(int(item["threadId"]))
            if getattr(thread, "archived", False):
                await thread.edit(archived=False)
            for part in split_message(item.get("text") or ""):
                await thread.send(part)
            await self.backend.ack(kind, item_id)
        elif kind == "unanswered":
            u = item.get("unanswered") or {}
            guild = getattr(getattr(admin_channel, "guild", None), "id", None)
            msg = await admin_channel.send(embed=embeds.unanswered_embed(u, guild), view=admin.unanswered_view(item_id))
            await self.backend.ack(kind, item_id, msg.id)
        elif kind == "unanswered_resolved":
            try:
                msg = await admin_channel.fetch_message(int(item["messageId"]))
                if msg.components:  # solved on the admin page
                    await msg.edit(embed=embeds.decided(msg.embeds[0] if msg.embeds else None, "resolved",
                                                        item.get("resolvedBy"), item.get("note")), view=None)
            except discord.NotFound:
                pass
            await self.backend.ack(kind, item_id)
        elif kind in ("proposal_decided", "draft_decided"):
            status = (item.get("proposal") or {}).get("status") or item.get("status") or "decided"
            try:
                channel = admin_channel
                if item.get("channelId"):  # posted in an admin-chat thread
                    channel = self.get_channel(int(item["channelId"])) or \
                        await self.fetch_channel(int(item["channelId"]))
                    if getattr(channel, "archived", False):
                        await channel.edit(archived=False)
                msg = await channel.fetch_message(int(item["messageId"]))
                if msg.components:  # still has buttons: decided elsewhere (admin page)
                    by = (item.get("proposal") or {}).get("decidedBy")
                    await msg.edit(embed=embeds.decided(msg.embeds[0] if msg.embeds else None, status, by),
                                   view=None)
            except discord.NotFound:
                pass
            await self.backend.ack(kind, item_id)
        else:
            return False
        return True
