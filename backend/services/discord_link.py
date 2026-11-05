"""Discord account linking (OAuth2 "identify" scope) and lookups by Discord user id.

Riders link Discord in the app so the help-channel bot knows which rider is asking.
Only the Discord user id and username are stored (`users/{id}.connections.discord`);
the OAuth access token is used once to read the identity and then discarded.
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import requests

from config import DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
TOKEN_URL = "https://discord.com/api/oauth2/token"
ME_URL = "https://discord.com/api/users/@me"
STATES_COLLECTION = "discord_oauth_states"
STATE_MAX_AGE_SECONDS = 600


class DiscordLinkError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def configured() -> bool:
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)


def authorize_url(state: str) -> str:
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
        "state": state,
        # Always show Discord's consent screen, so nobody is linked without seeing it.
        "prompt": "consent",
    })


def fetch_identity(code: str, *, http: Any = requests) -> dict:
    """Exchange the OAuth code and return `{userId, username}`; the token is not kept."""
    res = http.post(TOKEN_URL, data={
        "client_id": DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": DISCORD_REDIRECT_URI,
    }, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=15)
    if res.status_code != 200:
        raise DiscordLinkError("Discord did not accept the login, please try again", 502)
    access_token = (res.json() or {}).get("access_token")
    me = http.get(ME_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=15)
    if me.status_code != 200:
        raise DiscordLinkError("Could not read your Discord account, please try again", 502)
    data = me.json() or {}
    user_id = str(data.get("id") or "")
    if not user_id:
        raise DiscordLinkError("Discord returned no account id", 502)
    return {"userId": user_id, "username": str(data.get("global_name") or data.get("username") or "")}


def user_for_discord(db: Any, discord_user_id: str) -> tuple[str, dict] | None:
    """`(userDocId, userData)` of the rider linked to this Discord account, or None."""
    query = (db.collection("users")
             .where("connections.discord.userId", "==", str(discord_user_id))
             .limit(1))
    for snap in query.stream():
        return str(snap.id), (snap.to_dict() or {})
    return None
