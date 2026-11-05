"""Admin-channel embeds for proposals and reply drafts."""
from __future__ import annotations

import discord

PENDING_COLOUR = discord.Colour.gold()
APPEAL_COLOUR = discord.Colour.blurple()
DONE_COLOUR = discord.Colour.dark_grey()
DIVISIONS_FIELD = "Divisions"

FLAG_TEXT = {
    "few_strava_rides": "few Strava rides",
    "implausible_wkg": "implausible W/kg",
    "no_weight": "no weight",
    "strava_zwift_disagree": "Strava and Zwift disagree",
    "no_power_data": "no power data",
    "assessment_disagrees": "Claude differs from the predictor",
    "appeal_not_supported": "the numbers do not support the request",
}
STATUS_TEXT = {
    "approved": "✅ Approved", "edited": "✏️ Edited", "rejected": "❌ Rejected",
    "superseded": "↪️ Superseded by a newer proposal", "sent": "✅ Sent", "pending": "Pending",
}


def _cut(text: str | None, n: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def proposal_embed(p: dict) -> discord.Embed:
    appeal = p.get("origin") == "appeal"
    title = ("Appeal" if appeal else "Division proposal") + f": {p.get('name') or p.get('zwiftId')}"
    lines = [f"**{p.get('currentCategory') or 'No division'} → {p.get('proposedCategory') or 'needs a manual look'}**"]
    if p.get("predictedVelo") is not None:
        lines.append(f"Predicted vELO {p['predictedVelo']} from {p.get('source')}"
                     + (f" · {p['confidence']} confidence" if p.get("confidence") else ""))
    if p.get("suggestedCategory") and p.get("suggestedCategory") != p.get("proposedCategory"):
        lines.append(f"The predictor suggests {p['suggestedCategory']}.")
    rides = p.get("stravaRides") or {}
    if rides.get("activityCount") is not None:
        split = (f" ({rides.get('indoorCount')} indoor, {rides.get('outdoorCount')} outdoor)"
                 if rides.get("indoorCount") is not None else "")
        lines.append(f"Strava: {rides['activityCount']} rides in {rides.get('days') or 90} days{split}")
    embed = discord.Embed(title=_cut(title, 250), description=_cut("\n".join(lines), 4000),
                          colour=APPEAL_COLOUR if appeal else PENDING_COLOUR)
    if appeal:
        asked = f" for {p['requestedCategory']}" if p.get("requestedCategory") else ""
        embed.add_field(name=f"Rider asks{asked}", value=_cut(p.get("riderStatement") or "—", 1000), inline=False)
    if p.get("divisions"):
        # Read back by Edit, so the division names are known after a restart too.
        embed.add_field(name=DIVISIONS_FIELD, value=_cut(", ".join(p["divisions"]), 1000), inline=False)
    if p.get("flags"):
        embed.add_field(name="Flags", value=_cut(", ".join(FLAG_TEXT.get(f, f) for f in p["flags"]), 1000),
                        inline=False)
    if p.get("adminRationale"):
        embed.add_field(name="Rationale", value=_cut(p["adminRationale"], 1000), inline=False)
    preview = p.get("movePreview") or {}
    if p.get("locked") and (preview.get("message") or preview.get("error")):
        embed.add_field(name="Mid-season transfer", value=_cut(preview.get("message") or preview.get("error"), 1000),
                        inline=False)
    embed.set_footer(text=f"Zwift ID {p.get('zwiftId')} · proposal {p.get('id')}")
    return embed


DRAFT_MAX = 4000  # a modal text input holds at most 4000 characters


def draft_embed(d: dict) -> discord.Embed:
    # The draft is the description (up to 4096 characters), not a field (1024), so Edit can
    # prefill the whole answer from the post, also after a restart.
    embed = discord.Embed(title=_cut(f"Reply to {d.get('name') or d.get('zwiftId')}", 250),
                          description=_cut(d.get("draft") or "—", DRAFT_MAX), colour=PENDING_COLOUR)
    embed.add_field(name="Rider wrote", value=_cut(d.get("question") or "—", 1000), inline=False)
    if d.get("proposalId"):
        embed.add_field(name="Appeal", value="An appeal was filed with this message (see its own post).",
                        inline=False)
    embed.set_footer(text=f"Thread {d.get('threadId')} · draft {d.get('id')}")
    return embed


def decided(embed: discord.Embed | None, status: str, by: str | None = None,
            detail: str | None = None) -> discord.Embed:
    """The posted embed, marked as decided."""
    out = embed.copy() if embed is not None else discord.Embed()
    out.colour = DONE_COLOUR
    text = STATUS_TEXT.get(status, status) + (f" by {by}" if by else "") + (f" · {detail}" if detail else "")
    out.add_field(name="Decision", value=_cut(text, 1000), inline=False)
    return out
