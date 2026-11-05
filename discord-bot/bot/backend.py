"""HTTP client for the league backend's bot API (X-Bot-Token)."""
from __future__ import annotations

from typing import Any

import aiohttp


class BackendError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.message = message
        self.status = status


class Backend:
    def __init__(self, base_url: str, secret: str, session: aiohttp.ClientSession | None = None):
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self._session = session

    async def _session_(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120))
        return self._session

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()

    async def _call(self, method: str, path: str, body: dict | None = None) -> Any:
        session = await self._session_()
        async with session.request(method, self.base_url + path, json=body,
                                   headers={"X-Bot-Token": self.secret}) as res:
            try:
                data = await res.json(content_type=None)
            except Exception:
                data = {}
            if res.status >= 400:
                raise BackendError((data or {}).get("message") or f"HTTP {res.status}", res.status)
            return data

    async def ask(self, discord_user_id: int, thread_id: int, messages: list[dict]) -> dict:
        return await self._call("POST", "/bot/ask", {
            "discordUserId": str(discord_user_id), "threadId": str(thread_id), "messages": messages})

    async def pending(self) -> list[dict]:
        return (await self._call("GET", "/bot/pending")).get("items") or []

    async def ack(self, kind: str, item_id: str, message_id: int | None = None) -> None:
        body: dict = {"kind": kind, "id": item_id}
        if message_id is not None:
            body["messageId"] = str(message_id)
        await self._call("POST", "/bot/ack", body)

    async def decide_proposal(self, proposal_id: str, action: str, discord_user: str,
                              category: str | None = None, note: str | None = None) -> dict:
        return (await self._call("POST", f"/bot/proposals/{proposal_id}/decision", {
            "action": action, "category": category, "note": note, "discordUser": discord_user})).get("proposal") or {}

    async def decide_reply(self, draft_id: str, action: str, discord_user: str, text: str | None = None) -> dict:
        return (await self._call("POST", f"/bot/replies/{draft_id}/decision", {
            "action": action, "text": text, "discordUser": discord_user})).get("draft") or {}
