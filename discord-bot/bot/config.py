"""Bot settings from environment variables (set in the Render dashboard)."""
from __future__ import annotations

import os
from dataclasses import dataclass

REQUIRED = ("DISCORD_BOT_TOKEN", "HELP_CHANNEL_ID", "ADMIN_CHANNEL_ID", "ADMIN_ROLE_ID",
            "BACKEND_URL", "BOT_SHARED_SECRET")


@dataclass(frozen=True)
class Config:
    token: str
    help_channel_id: int
    admin_channel_id: int
    admin_role_id: int
    backend_url: str
    shared_secret: str
    poll_seconds: int = 60


def load(env: dict | None = None) -> Config:
    env = dict(os.environ if env is None else env)
    missing = [name for name in REQUIRED if not env.get(name)]
    if missing:
        raise SystemExit("Missing environment variables: " + ", ".join(missing))
    return Config(
        token=env["DISCORD_BOT_TOKEN"],
        help_channel_id=int(env["HELP_CHANNEL_ID"]),
        admin_channel_id=int(env["ADMIN_CHANNEL_ID"]),
        admin_role_id=int(env["ADMIN_ROLE_ID"]),
        backend_url=env["BACKEND_URL"].rstrip("/"),
        shared_secret=env["BOT_SHARED_SECRET"],
        poll_seconds=int(env.get("POLL_SECONDS") or 60),
    )
