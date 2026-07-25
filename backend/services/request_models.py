"""
Pydantic request models for API boundary validation.

Use `parse_body` to validate incoming JSON payloads at route boundaries.
Models use `extra='ignore'` so forward-compatible: unknown fields are
silently ignored rather than causing validation errors.
"""
from __future__ import annotations

from typing import Any, Literal

from flask import Response, jsonify
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


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


class SeasonRankPointTableRequest(BaseModel):
    byPlace: list[int] = Field(default_factory=list)
    ranges: list[dict[str, Any]] = Field(default_factory=list)

    model_config = {'extra': 'ignore'}


class SeasonRankPointsRequest(BaseModel):
    tour_overall: SeasonRankPointTableRequest | None = None
    tour_stage: SeasonRankPointTableRequest | None = None
    monument: SeasonRankPointTableRequest | None = None
    wt_classic: SeasonRankPointTableRequest | None = None

    model_config = {'extra': 'ignore'}


class LeagueSettingsRequest(BaseModel):
    name: str | None = None
    finishPoints: list[int] = Field(default_factory=list)
    sprintPoints: list[int] = Field(default_factory=list)
    leagueRankPoints: list[int] = Field(default_factory=list)
    bestRacesCount: int = 5
    gracePeriod: int | None = None
    seasonStart: str | None = None
    seasonRankPoints: SeasonRankPointsRequest | None = None
    seasonBestResultsCount: int | None = None

    model_config = {'extra': 'ignore'}


class StageRaceCreateRequest(BaseModel):
    name: str
    seasonClass: Literal['tour', 'monument', 'wt_classic']
    bestRacesCount: int = 1

    @field_validator('name')
    @classmethod
    def _name_non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('name is required')
        return v

    @field_validator('bestRacesCount')
    @classmethod
    def _best_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError('bestRacesCount must be >= 1')
        return v

    model_config = {'extra': 'ignore'}


class StageRaceUpdateRequest(BaseModel):
    name: str | None = None
    seasonClass: Literal['tour', 'monument', 'wt_classic'] | None = None
    bestRacesCount: int | None = None

    @field_validator('bestRacesCount')
    @classmethod
    def _best_positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError('bestRacesCount must be >= 1')
        return v

    model_config = {'extra': 'ignore'}


class StageRaceStagesRequest(BaseModel):
    """Replace stage attachment/order for an event."""
    stages: list[dict[str, Any]] = Field(default_factory=list)

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


# ── users_profile_routes models ───────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str | None = None
    zwiftId: str | None = None
    club: str = ''
    trainer: str = ''
    draft: bool = False
    acceptedCoC: bool = False
    acceptedDataPolicy: bool = False
    acceptedPublicResults: bool = False
    dataPolicyVersion: str | None = None
    publicResultsConsentVersion: str | None = None

    model_config = ConfigDict(extra='ignore')


class UpdateConsentsRequest(BaseModel):
    acceptedDataPolicy: bool = False
    acceptedPublicResults: bool = False
    dataPolicyVersion: str | None = None
    publicResultsConsentVersion: str | None = None

    model_config = ConfigDict(extra='ignore')


class SelectCategoryRequest(BaseModel):
    category: str = ''

    model_config = ConfigDict(extra='ignore')


class MarkNewsReadRequest(BaseModel):
    postId: str = ''

    @field_validator('postId')
    @classmethod
    def _post_id_non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('postId is required')
        return v

    model_config = ConfigDict(extra='ignore')


# ── admin_trainers models ─────────────────────────────────────────────────────

class CreateTrainerRequest(BaseModel):
    name: str
    status: str = 'approved'
    dualRecordingRequired: bool = False

    model_config = ConfigDict(extra='ignore')


class UpdateTrainerRequest(BaseModel):
    name: str | None = None
    status: str | None = None
    dualRecordingRequired: bool | None = None

    model_config = ConfigDict(extra='ignore')


class RequestTrainerRequest(BaseModel):
    trainerName: str
    requesterName: str = ''

    model_config = ConfigDict(extra='ignore')


class ApproveTrainerRequest(BaseModel):
    dualRecordingRequired: bool = False

    model_config = ConfigDict(extra='ignore')


# ── verification models ───────────────────────────────────────────────────────

class TriggerVerificationRequest(BaseModel):
    percentage: int = 5
    deadlineDays: int = 2
    raceId: str | None = None

    model_config = ConfigDict(extra='ignore')


class SubmitVerificationRequest(BaseModel):
    videoLink: str

    model_config = ConfigDict(extra='ignore')


class ReviewVerificationRequest(BaseModel):
    userId: str
    action: Literal['approve', 'reject']
    reason: str = ''

    model_config = ConfigDict(extra='ignore')
