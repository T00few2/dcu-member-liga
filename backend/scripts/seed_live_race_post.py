"""
Seed a Nyheder (news) post announcing the live-race feature.

Usage:
  # Create the post as a draft (review in admin before publishing)
  conda run -n py311 python backend/scripts/seed_live_race_post.py

  # Create and publish immediately
  conda run -n py311 python backend/scripts/seed_live_race_post.py --publish

  # Remove the seeded post
  conda run -n py311 python backend/scripts/seed_live_race_post.py --cleanup
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

_BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND_DIR))

_LOCAL_SA = _BACKEND_DIR / "serviceAccountKey.json"
if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and _LOCAL_SA.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(_LOCAL_SA)

logger = logging.getLogger("seed_live_race_post")

POST_SLUG = "ny-funktion-foelg-loebene-live"

# TipTap / ProseMirror JSONContent for the post body
POST_BODY = {
    "type": "doc",
    "content": [
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Vi er glade for at kunne introducere en helt ny funktion i "
                        "DCU Member Liga: live-race siden. Du kan nu følge løbene i "
                        "realtid direkte på hjemmesiden – mens rytterne kæmper om "
                        "pladserne."
                    ),
                }
            ],
        },
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "Hvad kan du se?"}],
        },
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Rytternes aktuelle position på ruten",
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Afstand og tidsforskel til førerfeltet",
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Fart, watt og puls for de deltagende ryttere",
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Grupper og udbrud efterhånden som de opstår",
                                }
                            ],
                        }
                    ],
                },
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": (
                                        "Nedtælling til næste løb, når der ikke er et "
                                        "aktivt løb i gang"
                                    ),
                                }
                            ],
                        }
                    ],
                },
            ],
        },
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "Sådan finder du siden"}],
        },
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": (
                        'Klik på "Live" i navigationen øverst på siden. Siden er '
                        "aktiv, når et DCU-løb er i gang, og viser ellers "
                        "nedtælling til den næste planlagte start."
                    ),
                }
            ],
        },
        {
            "type": "paragraph",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Vi håber, at det giver en ekstra dimension til oplevelsen "
                        "af ligaen. Har du feedback eller oplever du problemer, er "
                        "du meget velkommen til at give besked."
                    ),
                }
            ],
        },
    ],
}


def _init_firebase() -> firestore.Client:
    if firebase_admin._apps and _LOCAL_SA.exists():
        try:
            firestore.client()
        except Exception:
            for app in list(firebase_admin._apps.values()):
                firebase_admin.delete_app(app)

    if not firebase_admin._apps:
        gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if gac and os.path.exists(gac):
            firebase_admin.initialize_app(credentials.Certificate(gac))
        elif _LOCAL_SA.exists():
            firebase_admin.initialize_app(credentials.Certificate(str(_LOCAL_SA)))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def seed_post(db: firestore.Client, publish: bool) -> str:
    now = firestore.SERVER_TIMESTAMP
    status = "published" if publish else "draft"

    post_data = {
        "title": "Ny funktion: Følg løbene live",
        "slug": POST_SLUG,
        "coverImageUrl": None,
        "body": POST_BODY,
        "tags": ["nyheder", "live-race"],
        "status": status,
        "authorUid": "system",
        "authorName": "DCU Member Liga",
        "commentCount": 0,
        "publishedAt": now if publish else None,
        "createdAt": now,
        "updatedAt": now,
    }

    ref = db.collection("posts").document()
    ref.set(post_data)

    print(f"Created posts/{ref.id}")
    print(f"  title  : {post_data['title']}")
    print(f"  slug   : {post_data['slug']}")
    print(f"  status : {status}")
    print(f"  url    : /nyheder/{POST_SLUG}")
    return ref.id


def cleanup_post(db: firestore.Client) -> None:
    q = db.collection("posts").where("slug", "==", POST_SLUG).stream()
    deleted = 0
    for doc in q:
        doc.reference.delete()
        deleted += 1
        print(f"Deleted posts/{doc.id}")
    if not deleted:
        print(f"No post with slug '{POST_SLUG}' found.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish the post immediately (default: save as draft)",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete the seeded post",
    )
    args = parser.parse_args()

    db = _init_firebase()

    if args.cleanup:
        cleanup_post(db)
        return 0

    seed_post(db, publish=args.publish)
    if not args.publish:
        print("\nPost saved as draft. Open Admin → Nyheder to review and publish.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sys.exit(main())
