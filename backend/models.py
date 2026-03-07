"""
Domain model types for the DCU liga backend.

All structures are TypedDict so they are compatible with Firestore dicts and
require zero runtime overhead. Use these for static analysis (mypy/pyright)
rather than for runtime validation.

Firestore boundary note: .to_dict() returns dict[str, Any]. Cast or assert
to the appropriate TypedDict at the point where you first access the data.
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict


# ---------------------------------------------------------------------------
# Primitive aliases
# ---------------------------------------------------------------------------

SegmentType = Literal['sprint', 'split']
RaceType = Literal['scratch', 'points', 'time-trial']
RegistrationStatus = Literal['draft', 'complete']
VerificationStatus = Literal['none', 'pending', 'submitted', 'approved', 'rejected']
EventMode = Literal['single', 'multi']


# ---------------------------------------------------------------------------
# Sprint / segment
# ---------------------------------------------------------------------------

class SprintConfig(TypedDict, total=False):
    """A sprint or split segment as stored in race configuration."""
    id: str | int       # Zwift Segment ID
    key: str            # Computed key used as dict key; derived as f"{id}_{count}" if absent
    count: int          # Lap / crossing iteration (1-based)
    type: SegmentType
    name: str
    lap: int


class SprintDataEntry(TypedDict, total=False):
    """Per-rider, per-segment result stored in RiderResult.sprintData."""
    time: int       # Elapsed duration in milliseconds
    worldTime: int  # Zwift world-epoch timestamp in milliseconds
    avgPower: int
    rank: int       # 1-based crossing rank; 0 means DQ / not ranked


# ---------------------------------------------------------------------------
# Race results
# ---------------------------------------------------------------------------

class RiderResult(TypedDict, total=False):
    """
    A single rider's result within a race category.

    Fields are total=False because the dict is built incrementally:
    ZwiftFetcher creates the base structure, RaceScorer populates the
    points fields, and both are stored in Firestore verbatim.
    """
    zwiftId: str
    name: str
    finishTime: int       # Milliseconds; 0 means DNF
    finishRank: int       # 1-based; 0 means DNF or not ranked
    finishPoints: int
    sprintPoints: int
    totalPoints: int
    disqualified: bool
    declassified: bool
    flaggedCheating: bool
    flaggedSandbagging: bool
    criticalP: dict[str, Any]
    sprintData: dict[str, SprintDataEntry]
    sprintDetails: dict[str, int | float]   # points (sprint) or worldTime (split)
    isTestData: bool


# category label → ordered list of rider results
RaceResults = dict[str, list[RiderResult]]


# ---------------------------------------------------------------------------
# Race configuration (input to RaceScorer)
# ---------------------------------------------------------------------------

class CategoryConfig(TypedDict, total=False):
    """Per-category event source config (single-mode singleModeCategories entry)."""
    category: str
    sprints: list[SprintConfig]
    segmentType: SegmentType
    laps: int


class EventConfig(TypedDict, total=False):
    """Per-category event source config (multi-mode eventConfiguration entry)."""
    eventId: str
    eventSecret: str
    customCategory: str
    sprints: list[SprintConfig]
    segmentType: SegmentType
    laps: int
    startTime: str


class RaceConfig(TypedDict, total=False):
    """
    The dict passed into RaceScorer.calculate_results and LeagueEngine methods.
    Built by ResultsProcessor._get_category_config.
    """
    manualDQs: list[str]
    manualDeclassifications: list[str]
    manualExclusions: list[str]
    sprints: list[SprintConfig]
    segmentType: SegmentType
    type: RaceType
    # Included so LeagueEngine can resolve category-specific sprint config
    eventMode: EventMode
    eventConfiguration: list[EventConfig]
    singleModeCategories: list[CategoryConfig]
    startTime: str
    date: str


# ---------------------------------------------------------------------------
# League settings and standings
# ---------------------------------------------------------------------------

class LeagueSettings(TypedDict, total=False):
    """Document: league/settings."""
    name: str
    finishPoints: list[int]
    sprintPoints: list[int]
    leagueRankPoints: list[int]
    bestRacesCount: int


class LeagueRaceResult(TypedDict):
    """One race's contribution to a rider's league entry."""
    raceId: str | None
    points: int


class LeagueEntry(TypedDict, total=False):
    """A rider's aggregated entry in the league standings for one category."""
    zwiftId: str
    name: str
    totalPoints: int
    raceCount: int
    results: list[LeagueRaceResult]
    lastRacePoints: int
    lastRaceDate: Any   # datetime | None at runtime


# category label → ordered list of league entries
LeagueStandings = dict[str, list[LeagueEntry]]


# ---------------------------------------------------------------------------
# User / participant
# ---------------------------------------------------------------------------

class StravaConnection(TypedDict, total=False):
    athlete_id: int


class PolicyConsent(TypedDict, total=False):
    version: str
    acceptedAt: Any     # Firestore Timestamp


class Registration(TypedDict, total=False):
    status: RegistrationStatus
    cocAccepted: bool
    dataPolicy: PolicyConsent
    publicResultsConsent: PolicyConsent


class VerificationRequest(TypedDict, total=False):
    requestId: str
    requestedAt: str    # ISO 8601
    type: Literal['weight']
    status: VerificationStatus
    deadline: Any       # datetime
    videoLink: str
    submittedAt: str
    reviewedAt: str
    reviewerId: str
    rejectionReason: str


class Verification(TypedDict, total=False):
    status: VerificationStatus
    currentRequest: VerificationRequest
    history: list[VerificationRequest]


class ZwiftPowerProfile(TypedDict, total=False):
    category: str
    ftp: str | int
    updatedAt: Any


class ZwiftRacingProfile(TypedDict, total=False):
    currentRating: str | int
    max30Rating: str | int
    max90Rating: str | int
    phenotype: str
    updatedAt: Any


class ZwiftGameProfile(TypedDict, total=False):
    ftp: int
    weight: int
    height: int
    racingScore: int
    updatedAt: Any


class UserDoc(TypedDict, total=False):
    """
    Firestore document shape for the 'users' collection.
    All fields optional because documents are built incrementally across
    the registration flow.
    """
    authUid: str
    email: str
    name: str
    eLicense: str
    zwiftId: str
    club: str
    registration: Registration
    verification: Verification
    connections: dict[str, Any]     # {'strava': StravaConnection, ...}
    equipment: dict[str, str]       # {'trainer': str}
    zwiftPower: ZwiftPowerProfile
    zwiftRacing: ZwiftRacingProfile
    zwiftProfile: ZwiftGameProfile
    stravaSummary: dict[str, Any]
    welcomeSeen: bool
    updatedAt: Any
    createdAt: Any
    isTestData: bool
