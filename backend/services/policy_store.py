from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from firebase_admin import firestore


POLICY_DATA_POLICY = "dataPolicy"
POLICY_PUBLIC_RESULTS = "publicResultsConsent"

KNOWN_POLICIES = [POLICY_DATA_POLICY, POLICY_PUBLIC_RESULTS]


class PolicyError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class PolicyMeta:
    policyKey: str
    displayVersion: str
    requiredVersion: str


def _policy_doc(db, policy_key: str):
    return db.collection("policies").document(policy_key)


def _version_doc(db, policy_key: str, version_id: str):
    return _policy_doc(db, policy_key).collection("versions").document(version_id)


def _default_policy_markdown(policy_key: str) -> Tuple[str, str]:
    """
    Returns (title_da, content_md_da) defaults used when nothing is configured in Firestore yet.
    These defaults let the app run before the first policy publish via admin UI.
    """
    if policy_key == POLICY_DATA_POLICY:
        return (
            "Datapolitik",
            """# Datapolitik

**Version:** 2026-02-03  
**Sidst opdateret:** 3. februar 2026

## 1. Hvem er vi (dataansvarlig)?
Denne datapolitik gælder for DCU Member League (“Ligaen”) og beskriver, hvordan vi behandler personoplysninger i forbindelse med tilmelding, gennemførelse og offentliggørelse af resultater til e-cykling events.

**Dataansvarlig:** DCU Member League (arrangørgruppen)  
**Kontakt:** *(indsæt kontakt-e-mail, fx en DCU/arrangør-mailboks)*

## 2. Hvilke oplysninger behandler vi?
Vi behandler følgende kategorier af oplysninger (afhængigt af hvilke funktioner du bruger):

- **Login og identitet:** Firebase Auth bruger-id (UID) og evt. navn/profilbillede fra din Google-konto.
- **Tilmeldingsoplysninger:** navn, DCU e-licensnummer, Zwift ID, klubtilhørsforhold, valg af trainer/powermeter samt dine accept/samtykker.
- **Liga- og resultatdata:** løb (racer) og tilhørende resultater, sprint/split data, stillinger/pointberegninger samt manuelle afgørelser (fx DQ/deklassificering/ekskludering) foretaget af admins.
- **Integrationer (afhængigt af valg):**
  - **Strava:** OAuth-tokens (adgang/refresh/udløb) og aktivitetsdata/streams i det omfang du forbinder Strava.
  - **Zwift:** profiloplysninger og event-/resultatdata, som bruges til resultatudregning.
  - **ZwiftPower og ZwiftRacing:** rating/kategori/phenotype og historik/statistik, hvor det er relevant for visning/verifikation.
- **Tekniske data:** drifts- og fejllogs fra backend (Google Cloud Functions) kan indeholde tidsstempler og tekniske fejlbeskeder og kan i nogle tilfælde indeholde identifikatorer (fx Zwift ID eller e-licens), hvis de indgår i en fejl.

## 2a. Overblik: data, formål, retsgrundlag, synlighed og opbevaring
Tabellen nedenfor er et praktisk overblik. Den erstatter ikke resten af teksten, men gør det tydeligt hvilke data vi bruger, hvorfor og hvem der kan se dem.

| Data | Formål | Retsgrundlag (GDPR) | Hvor lagres | Synlighed | Opbevaring |
|---|---|---|---|---|---|
| Firebase Auth UID (og evt. navn/profilbillede) | Login og adgang | Aftale (6(1)(b)) / legitim interesse (6(1)(f)) | Firebase Auth | Ikke offentligt | Så længe konto bruges, eller til sletning |
| Navn, e-licens, Zwift ID, klub, trainer/powermeter | Tilmelding, administration, verifikation | Aftale (6(1)(b)) / legitim interesse (6(1)(f)) | Firestore | Navn kan indgå i offentlige resultater (se særskilt accept) | Så længe ligaen drives + rimelig historikperiode |
| Samtykker/accept (Code of Conduct, datapolitik, offentliggørelse) | Dokumentation for accept | Legitim interesse (6(1)(f)) / samtykke hvor relevant (6(1)(a)) | Firestore | Ikke offentligt; admins kan tilgå ved behov | Så længe kontoen/historik opbevares |
| Resultater, sprint/split data, stillinger/point | Beregning og visning | Legitim interesse (6(1)(f)) / aftale (6(1)(b)) | Firestore | Kan være offentligt (web/livestream overlays) | Opbevares som liga-historik |
| Manuelle afgørelser (DQ/deklassificering/ekskludering) | Fair play og korrekt resultatliste | Legitim interesse (6(1)(f)) | Firestore | Resultatpåvirkning kan være synlig; detaljer primært admin | Som del af resultathistorik |
| Strava tokens + aktivitetsdata (hvis tilkoblet) | Valgfri integration | Samtykke (6(1)(a)) | Firestore | Ikke offentligt som udgangspunkt | Indtil frakobling/sletning |
| Zwift/ZwiftPower/ZwiftRacing statistik | Stats og støtte til verifikation | Legitim interesse (6(1)(f)) | Firestore (cache) + hentes ved behov | Typisk egen profil og/eller admin | Opdateres løbende; historik efter behov |
| Tekniske logs | Drift/fejlsøgning/sikkerhed | Legitim interesse (6(1)(f)) | Google Cloud Logging | Kun drift/udviklere med adgang | Begrænset retention |

## 3. Formål med behandlingen
- **Administration af ligaen:** oprettelse af løb, opsætning af pointskemaer og håndtering af deltagere.
- **Gennemførelse og resultater:** indhentning af event-/resultatdata, beregning af point, og publicering/visning af resultater og stillinger.
- **Verifikation og fair play:** verificering af oplysninger (fx Zwift ID og udstyr) samt støtte til kontrol af mulige afvigelser.
- **Strava-funktionalitet (valgfrit):** visning af aktivitetsopsummeringer og/eller streams, hvis du aktivt forbinder din Strava-konto.
- **Support og drift:** fejlsøgning, forbedringer og sikker drift.

## 4. Retsgrundlag (GDPR)
Vi behandler personoplysninger på følgende grundlag (afhængigt af situationen):

- **Opfyldelse af aftale** (GDPR art. 6(1)(b)): for at kunne administrere din deltagelse og levere ligafunktionalitet.
- **Legitim interesse** (GDPR art. 6(1)(f)): for at kunne drive ligaen, beregne og offentliggøre resultater, samt forebygge misbrug og sikre fair konkurrence.
- **Samtykke** (GDPR art. 6(1)(a)): for valgfrie integrationer, herunder Strava, hvor du aktivt forbinder din konto.

## 5. Offentliggørelse af resultater
Ligaen er designet til at vise resultater og stillinger. Det kan betyde, at dele af dine oplysninger (typisk navn, kategori, placering og point) vises på websiden og kan indgå i streaming overlays (fx OBS) i forbindelse med live visning.

**Bemærk:** I forbindelse med registrering beder vi om din særskilte accept til offentliggørelse af navn og resultater. Denne accept registreres (med versionsnummer og tidspunkt) sammen med din deltagerprofil.

## 6. Modtagere, databehandlere og tredjepart
Vi bruger følgende leverandører (databehandlere/tredjeparter) som led i driften:

- **Google Firebase** (Auth/Firestore) og **Google Cloud** (Cloud Functions/logging) til login, database og backend drift.
- **Vercel** til hosting af frontend.
- **Strava** til OAuth og aktivitetsdata, hvis du forbinder Strava.
- **Zwift** og relaterede datakilder (ZwiftPower/ZwiftRacing) til event-/profil-/statistikdata.

Bemærk: Nogle leverandører kan behandle data uden for EU/EØS. I sådanne tilfælde baseres overførsel typisk på EU-kommissionens standardkontraktbestemmelser (SCC) og/eller andre relevante overførselsgrundlag afhængigt af leverandørens setup.

## 7. Opbevaring og sletning
- **Deltagerprofil:** opbevares så længe du deltager i ligaen og i en rimelig periode derefter af hensyn til historik og dokumentation.
- **Resultater og stillinger:** opbevares som historik for ligaen.
- **Strava-tokens:** opbevares kun så længe forbindelsen er aktiv; du kan til enhver tid afbryde forbindelsen.
- **Logs:** opbevares i en begrænset periode til fejlsøgning og drift (typisk i henhold til cloud-udbyderens log-retention).

## 8. Dine rettigheder
Du har ret til indsigt, berigtigelse, sletning, begrænsning, dataportabilitet og indsigelse (afhængigt af behandlingsgrundlag), samt ret til at trække samtykke tilbage (fx Strava).

For henvendelser om dine rettigheder, kontakt os på den angivne kontaktadresse.

## 9. Sikkerhed
Vi anvender adgangskontrol og tekniske/organisatoriske foranstaltninger for at beskytte data. Admin-funktioner kræver særskilte rettigheder, og adgang til driftssystemer er begrænset til betroede personer.

## 10. Cookies og lokal lagring
Tjenesten bruger typisk lokal lagring og/eller cookies som led i login (Firebase) og for at sikre en stabil brugeroplevelse.

## 11. Ændringer
Vi kan opdatere denne datapolitik ved behov. Den seneste version vil altid være tilgængelig med versionsnummer og dato.

## 12. Kontakt
Spørgsmål til datapolitikken kan sendes til arrangørgruppen på den angivne kontaktadresse.
""",
        )

    if policy_key == POLICY_PUBLIC_RESULTS:
        return (
            "Offentliggørelse af navn og resultater",
            """# Offentliggørelse af navn og resultater

**Version:** 2026-02-03

Ligaen offentliggør normalt resultater og stillinger (fx på websiden og i live overlays til streaming).
Dette kan omfatte dit **navn**, **kategori**, **placering** og **point**.

Ved accept bekræfter du, at dit navn og dine resultater må offentliggøres som en del af ligaens resultater og stillinger.
""",
        )

    raise PolicyError("Unknown policy key", 404)


def get_policy_meta(db) -> Dict[str, Dict[str, Any]]:
    """
    Returns authoritative meta for known policies:
      { policyKey: { displayVersion, requiredVersion } }
    Falls back to defaults if Firestore has no configuration yet.
    """
    meta: Dict[str, Dict[str, Any]] = {}

    default_version = "2026-02-03"

    for key in KNOWN_POLICIES:
        doc = _policy_doc(db, key).get() if db else None
        if doc and doc.exists:
            data = doc.to_dict() or {}
            meta[key] = {
                "displayVersion": data.get("currentDisplayVersion") or default_version,
                "requiredVersion": data.get("currentRequiredVersion") or data.get("currentDisplayVersion") or default_version,
            }
        else:
            meta[key] = {"displayVersion": default_version, "requiredVersion": default_version}
    return meta


def get_current_policy(db, policy_key: str) -> Dict[str, Any]:
    """
    Returns the display policy document. If missing from Firestore, returns defaults.
    """
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)

    meta = get_policy_meta(db)
    display_version = meta[policy_key]["displayVersion"]

    if db:
        vdoc = _version_doc(db, policy_key, display_version).get()
        if vdoc.exists:
            data = vdoc.to_dict() or {}
            return {
                "policyKey": policy_key,
                "version": display_version,
                "titleDa": data.get("titleDa") or _default_policy_markdown(policy_key)[0],
                "contentMdDa": data.get("contentMdDa") or _default_policy_markdown(policy_key)[1],
                "requiresReaccept": bool(data.get("requiresReaccept", False)),
                "changeType": data.get("changeType") or ("major" if data.get("requiresReaccept") else "minor"),
                "status": data.get("status") or "published",
                "publishedAt": data.get("publishedAt"),
                "changeSummary": data.get("changeSummary") or "",
            }

    title, content = _default_policy_markdown(policy_key)
    return {
        "policyKey": policy_key,
        "version": display_version,
        "titleDa": title,
        "contentMdDa": content,
        "requiresReaccept": True,
        "changeType": "major",
        "status": "published",
        "publishedAt": None,
        "changeSummary": "",
    }


def list_versions(db, policy_key: str) -> List[Dict[str, Any]]:
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)
    if not db:
        return []

    versions_ref = _policy_doc(db, policy_key).collection("versions")
    docs = versions_ref.order_by("createdAt", direction=firestore.Query.DESCENDING).stream()
    out: List[Dict[str, Any]] = []
    for d in docs:
        data = d.to_dict() or {}
        data["version"] = d.id
        out.append(data)
    return out


def _to_epoch_ms(value: Any) -> Any:
    """
    Convert Firestore timestamps / datetimes to epoch ms for JSON.
    Leaves other types unchanged.
    """
    try:
        # Firestore Timestamp often behaves like datetime with .timestamp()
        if hasattr(value, "timestamp"):
            return int(value.timestamp() * 1000)
    except Exception:
        pass
    return value


def serialize_policy_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """
    Best-effort JSON-safe serialization for policy docs.
    """
    out: Dict[str, Any] = {}
    for k, v in (doc or {}).items():
        if isinstance(v, dict):
            out[k] = serialize_policy_doc(v)
        elif isinstance(v, list):
            out[k] = [serialize_policy_doc(x) if isinstance(x, dict) else _to_epoch_ms(x) for x in v]
        else:
            out[k] = _to_epoch_ms(v)
    return out


def upsert_draft(
    db,
    policy_key: str,
    version: str,
    *,
    title_da: str,
    content_md_da: str,
    change_type: str,
    requires_reaccept: bool,
    actor_uid: str,
) -> None:
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)
    if not db:
        raise PolicyError("Database not available", 500)
    if not version:
        raise PolicyError("Missing version", 400)
    if change_type not in ("minor", "major"):
        raise PolicyError("Invalid changeType", 400)

    doc_ref = _version_doc(db, policy_key, version)
    existing = doc_ref.get()
    if existing.exists:
        existing_data = existing.to_dict() or {}
        status = existing_data.get("status", "draft")
        if status != "draft":
            raise PolicyError("Cannot edit after submission/publish", 409)

    payload = {
        "titleDa": title_da,
        "contentMdDa": content_md_da,
        "changeType": change_type,
        "requiresReaccept": bool(requires_reaccept),
        "status": "draft",
        "createdByUid": actor_uid,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    if not existing.exists:
        payload["createdAt"] = firestore.SERVER_TIMESTAMP

    doc_ref.set(payload, merge=True)


def submit_for_review(db, policy_key: str, version: str, *, actor_uid: str) -> None:
    if not db:
        raise PolicyError("Database not available", 500)
    doc_ref = _version_doc(db, policy_key, version)
    snap = doc_ref.get()
    if not snap.exists:
        raise PolicyError("Version not found", 404)
    data = snap.to_dict() or {}
    if data.get("status") != "draft":
        raise PolicyError("Only drafts can be submitted", 409)

    doc_ref.set(
        {
            "status": "pending_review",
            "submittedAt": firestore.SERVER_TIMESTAMP,
            "submittedByUid": actor_uid,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def approve_version(db, policy_key: str, version: str, *, actor_uid: str) -> None:
    if not db:
        raise PolicyError("Database not available", 500)
    doc_ref = _version_doc(db, policy_key, version)
    snap = doc_ref.get()
    if not snap.exists:
        raise PolicyError("Version not found", 404)
    data = snap.to_dict() or {}
    if data.get("status") != "pending_review":
        raise PolicyError("Only pending_review versions can be approved", 409)

    created_by = data.get("createdByUid")
    if created_by and created_by == actor_uid:
        raise PolicyError("Four-eyes: author cannot approve own version", 403)

    doc_ref.set(
        {
            "status": "approved",
            "approvedAt": firestore.SERVER_TIMESTAMP,
            "approvedByUid": actor_uid,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def publish_version(
    db,
    policy_key: str,
    version: str,
    *,
    actor_uid: str,
    change_summary: str = "",
) -> Dict[str, Any]:
    """
    Publish a version and update policy meta.
    Four-eyes rule:
      - minor: can be published by author (status must be draft)
      - major (requiresReaccept): must be approved by a different admin first (status must be approved)
    """
    if not db:
        raise PolicyError("Database not available", 500)
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)

    policy_ref = _policy_doc(db, policy_key)
    version_ref = _version_doc(db, policy_key, version)

    @firestore.transactional
    def txn(transaction):
        vsnap = version_ref.get(transaction=transaction)
        if not vsnap.exists:
            raise PolicyError("Version not found", 404)
        v = vsnap.to_dict() or {}
        status = v.get("status", "draft")
        requires = bool(v.get("requiresReaccept", False))
        created_by = v.get("createdByUid")
        approved_by = v.get("approvedByUid")

        if requires:
            if status != "approved":
                raise PolicyError("Major changes must be approved before publish", 409)
            if created_by and approved_by and created_by == approved_by:
                raise PolicyError("Four-eyes: author cannot approve own version", 403)
            if not approved_by:
                raise PolicyError("Missing approval", 409)
        else:
            if status not in ("draft", "approved"):
                raise PolicyError("Only drafts can be published", 409)

        transaction.set(
            version_ref,
            {
                "status": "published",
                "publishedAt": firestore.SERVER_TIMESTAMP,
                "publishedByUid": actor_uid,
                "changeSummary": change_summary or v.get("changeSummary", ""),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        updates = {
            "currentDisplayVersion": version,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if requires:
            updates["currentRequiredVersion"] = version
        transaction.set(policy_ref, updates, merge=True)

        return {"displayVersion": version, "requiredVersion": updates.get("currentRequiredVersion")}

    transaction = db.transaction()
    return txn(transaction)

