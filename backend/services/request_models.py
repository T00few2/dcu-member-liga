"""
Pydantic request models for API boundary validation.

Use `parse_body` to validate incoming JSON payloads at route boundaries.
Models use `extra='ignore'` so forward-compatible: unknown fields are
silently ignored rather than causing validation errors.
"""
from __future__ import annotations

from typing import Any, Literal

from flask import Response, jsonify
from pydantic import BaseModel, Field, ValidationError, field_validator


def parse_body(
    cls: type[BaseModel],
    payload: dict[str, Any],
) -> tuple[BaseModel, None] | tuple[None, tuple[Response, int]]:
    """Validate *payload* against *cls*.

    Returns ``(model_instance, None)`` on success, or
    ``(None, (json_response, 400))`` on validation failure.
    """
    try:
        return cls.model_validate(payload), None
    except ValidationError as exc:
        msgs = '; '.join(
            f"{'.'.join(map(str, e['loc']))}: {e['msg']}"
            for e in exc.errors()
        )
        return None, (jsonify({'error': msgs}), 400)


class LeagueSettingsRequest(BaseModel):
    name: str | None = None
    finishPoints: list[int] = Field(default_factory=list)
    sprintPoints: list[int] = Field(default_factory=list)
    leagueRankPoints: list[int] = Field(default_factory=list)
    bestRacesCount: int = 5
    gracePeriod: int | None = None
    seasonStart: str | None = None

    model_config = {'extra': 'ignore'}


class SendEmailRequest(BaseModel):
    userIds: list[str] = Field(default_factory=list)
    zwiftIds: list[str] = Field(default_factory=list)
    subject: str
    message: str
    sendMode: Literal['individual', 'group'] = 'individual'
    recipientMode: Literal['to', 'cc', 'bcc'] = 'bcc'
    manualTo: str = ''
    manualCc: str = ''
    manualBcc: str = ''

    @field_validator('subject')
    @classmethod
    def _subject_single_line(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('subject is required')
        if '\r' in v or '\n' in v:
            raise ValueError('subject must be a single line')
        return v

    @field_validator('message')
    @classmethod
    def _message_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError('message is required')
        return v

    model_config = {'extra': 'ignore'}
