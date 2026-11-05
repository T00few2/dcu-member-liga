"""Admin channel: buttons and modals on proposals and reply drafts.

Buttons are persistent `DynamicItem`s (custom_id `dcu:<prop|draft>:<action>:<id>`), so
they keep working after the bot restarts. Only members with the admin role may use them.
"""
from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

import discord

from bot import embeds
from bot.backend import BackendError

if TYPE_CHECKING:
    from bot.client import DcuBot

logger = logging.getLogger(__name__)

PROPOSAL_ACTIONS = (("approve", "Approve", discord.ButtonStyle.success),
                    ("edit", "Edit", discord.ButtonStyle.primary),
                    ("reject", "Reject", discord.ButtonStyle.danger))
DRAFT_ACTIONS = (("send", "Send", discord.ButtonStyle.success),
                 ("edit", "Edit", discord.ButtonStyle.primary),
                 ("reject", "Reject", discord.ButtonStyle.danger))


def is_admin(member: discord.abc.User, admin_role_id: int) -> bool:
    return any(getattr(role, "id", None) == admin_role_id for role in getattr(member, "roles", []) or [])


def who(user: discord.abc.User) -> str:
    return getattr(user, "display_name", None) or getattr(user, "name", None) or str(user.id)


def proposal_view(proposal_id: str) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    for action, label, style in PROPOSAL_ACTIONS:
        view.add_item(ActionButton("prop", action, proposal_id, label=label, style=style))
    return view


def draft_view(draft_id: str) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    for action, label, style in DRAFT_ACTIONS:
        view.add_item(ActionButton("draft", action, draft_id, label=label, style=style))
    return view


async def _finish(interaction: discord.Interaction, status: str, detail: str | None = None) -> None:
    """Mark the admin post as decided and remove its buttons."""
    message = interaction.message
    embed = embeds.decided(message.embeds[0] if message and message.embeds else None, status,
                           who(interaction.user), detail)
    if interaction.response.is_done():
        await interaction.edit_original_response(embed=embed, view=None)
    else:
        await interaction.response.edit_message(embed=embed, view=None)


async def _fail(interaction: discord.Interaction, text: str) -> None:
    if interaction.response.is_done():
        await interaction.followup.send(text, ephemeral=True)
    else:
        await interaction.response.send_message(text, ephemeral=True)


def _division(text: str, divisions: list[str]) -> str | None:
    wanted = (text or "").strip().lower()
    return next((d for d in divisions if d.lower() == wanted), None) if divisions else (text or "").strip() or None


class ProposalEditModal(discord.ui.Modal, title="Choose a division"):
    def __init__(self, bot: "DcuBot", proposal_id: str, divisions: list[str], current: str | None):
        super().__init__()
        self.bot, self.proposal_id, self.divisions = bot, proposal_id, divisions
        self.division = discord.ui.TextInput(label="Division", default=current or "", max_length=40,
                                             placeholder=", ".join(divisions)[:100] or None)
        self.note = discord.ui.TextInput(label="Note (optional)", required=False, max_length=500,
                                         style=discord.TextStyle.paragraph)
        self.add_item(self.division)
        self.add_item(self.note)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        division = _division(self.division.value, self.divisions)
        if not division:
            await _fail(interaction, "Unknown division. Choose one of: " + ", ".join(self.divisions))
            return
        await interaction.response.defer()
        try:
            result = await self.bot.backend.decide_proposal(self.proposal_id, "edit", who(interaction.user),
                                                            category=division, note=self.note.value or None)
        except BackendError as e:
            await _fail(interaction, e.message)
            return
        await _finish(interaction, result.get("status") or "edited", f"→ {division}")


class RejectModal(discord.ui.Modal, title="Reject"):
    """Rejecting a proposal asks for an optional note (a modal needs at least one input)."""

    def __init__(self, bot: "DcuBot", proposal_id: str):
        super().__init__()
        self.bot, self.proposal_id = bot, proposal_id
        self.note = discord.ui.TextInput(label="Note (optional, kept for the admins)", required=False,
                                         max_length=500, style=discord.TextStyle.paragraph)
        self.add_item(self.note)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        try:
            await self.bot.backend.decide_proposal(self.proposal_id, "reject", who(interaction.user),
                                                   note=self.note.value or None)
        except BackendError as e:
            await _fail(interaction, e.message)
            return
        await _finish(interaction, "rejected")


class DraftEditModal(discord.ui.Modal, title="Edit the reply"):
    def __init__(self, bot: "DcuBot", draft_id: str, draft_text: str):
        super().__init__()
        self.bot, self.draft_id = bot, draft_id
        self.text = discord.ui.TextInput(label="Reply to the rider", default=draft_text[:embeds.DRAFT_MAX],
                                         max_length=embeds.DRAFT_MAX, style=discord.TextStyle.paragraph)
        self.add_item(self.text)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        try:
            await self.bot.backend.decide_reply(self.draft_id, "edit", who(interaction.user), text=self.text.value)
        except BackendError as e:
            await _fail(interaction, e.message)
            return
        await _finish(interaction, "edited")


def _embed_field(message: discord.Message | None, name: str) -> str:
    for embed in (message.embeds if message else []):
        for field in embed.fields:
            if field.name == name:
                return field.value or ""
    return ""


def _embed_description(message: discord.Message | None) -> str:
    embeds_ = message.embeds if message else []
    return (embeds_[0].description or "") if embeds_ else ""


def post_divisions(message: discord.Message | None) -> list[str]:
    """Division names listed on a proposal post (survives bot restarts)."""
    text = _embed_field(message, embeds.DIVISIONS_FIELD)
    return [d.strip() for d in text.split(",") if d.strip()]


TEMPLATE = r"dcu:(?P<kind>prop|draft):(?P<action>[a-z]+):(?P<id>[0-9a-zA-Z_-]+)"


class ActionButton(discord.ui.DynamicItem[discord.ui.Button], template=TEMPLATE):
    def __init__(self, kind: str, action: str, item_id: str, *, label: str = "",
                 style: discord.ButtonStyle = discord.ButtonStyle.secondary):
        super().__init__(discord.ui.Button(label=label or action.title(), style=style,
                                           custom_id=f"dcu:{kind}:{action}:{item_id}"))
        self.kind, self.action, self.item_id = kind, action, item_id

    @classmethod
    async def from_custom_id(cls, interaction: discord.Interaction, item: discord.ui.Button,
                             match: re.Match[str], /):
        return cls(match["kind"], match["action"], match["id"], label=item.label or "", style=item.style)

    async def callback(self, interaction: discord.Interaction) -> None:
        bot: DcuBot = interaction.client  # type: ignore[assignment]
        if not is_admin(interaction.user, bot.config.admin_role_id):
            await _fail(interaction, "Only league admins can do this.")
            return
        if self.kind == "prop" and self.action == "reject":
            await interaction.response.send_modal(RejectModal(bot, self.item_id))
            return
        if self.kind == "prop" and self.action == "edit":
            divisions = (bot.divisions.get(self.item_id) or post_divisions(interaction.message)
                         or bot.known_divisions)
            await interaction.response.send_modal(ProposalEditModal(bot, self.item_id, divisions, None))
            return
        if self.kind == "draft" and self.action == "edit":
            await interaction.response.send_modal(
                DraftEditModal(bot, self.item_id, _embed_description(interaction.message)))
            return
        await interaction.response.defer()
        try:
            if self.kind == "prop":
                result = await bot.backend.decide_proposal(self.item_id, "approve", who(interaction.user))
                await _finish(interaction, result.get("status") or "approved",
                              f"→ {result.get('appliedCategory')}" if result.get("appliedCategory") else None)
            elif self.action == "reject":  # a rejected draft sends nothing; no note needed
                await bot.backend.decide_reply(self.item_id, "reject", who(interaction.user))
                await _finish(interaction, "rejected")
            else:
                await bot.backend.decide_reply(self.item_id, "send", who(interaction.user))
                await _finish(interaction, "sent")
        except BackendError as e:
            await _fail(interaction, e.message)
