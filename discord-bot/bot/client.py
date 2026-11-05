"""The bot: help-channel threads and the admin-channel relay.

Help channel: a rider's new message opens a thread; each message from that rider in the
thread goes to the backend (`/bot/ask`) with the thread history, and the bot posts the
answer (or a holding message while an admin approves the draft). Other people writing
in the thread (admins answering by hand) are ignored.

Admin channel: every `poll_seconds` the bot asks the backend what to post or deliver
(`/bot/pending`: proposals, reply drafts and questions the bot could not answer) and
acknowledges each item (`/bot/ack`) so nothing is sent twice.
"""
from __future__ import annotations

import asyncio
import logging

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


def thread_name(message: discord.Message) -> str:
    base = (message.content or "Spørgsmål").strip().splitlines()[0]
    return f"{message.author.display_name}: {base}"[:95]


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
                msg = await admin_channel.fetch_message(int(item["messageId"]))
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
