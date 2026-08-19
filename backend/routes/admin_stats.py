"""
Admin: League statistics overview.

Provides aggregated stats for the admin stats dashboard tab.
Registered on admin_bp (defined in routes/admin.py).
"""
from flask import request, jsonify
from collections import Counter, defaultdict

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db

import logging

logger = logging.getLogger(__name__)

# Dual-recording buckets used by the trainer analysis breakdowns.
DR_REQUIRED = 'required'
DR_NOT_REQUIRED = 'notRequired'
DR_UNKNOWN = 'unknown'


def _normalize_trainer_name(name: str) -> str:
    """Normalize trainer names so user equipment matches the trainers catalog."""
    return ' '.join((name or '').strip().lower().split())


def _load_trainer_dual_recording_map() -> dict:
    """Build {normalizedName -> dualRecordingRequired} from the trainers catalog."""
    lookup: dict = {}
    try:
        for doc in db.collection('trainers').stream():
            td = doc.to_dict() or {}
            norm = td.get('normalizedName') or _normalize_trainer_name(td.get('name', ''))
            if norm:
                lookup[norm] = bool(td.get('dualRecordingRequired'))
    except Exception:
        logger.warning('Failed to load trainers catalog for stats', exc_info=True)
    return lookup


@admin_bp.route('/admin/stats', methods=['GET'])
def get_league_stats():
    """Return aggregated league statistics."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    try:
        trainer_dr_map = _load_trainer_dual_recording_map()

        users_ref = db.collection('users')
        docs = users_ref.stream()

        total = 0
        reg_status_counter = Counter()
        club_counter = Counter()
        category_counter = Counter()
        trainer_counter = Counter()
        verification_counter = Counter()
        phenotype_counter = Counter()
        locked_count = 0
        self_selected_count = 0
        # {trainer -> dual-recording bucket}
        trainer_dr_bucket: dict = {}
        # {category -> Counter(trainer -> count)}
        trainer_by_category: dict = defaultdict(Counter)
        # {category -> Counter(dual-recording bucket -> count)}
        dr_by_category: dict = defaultdict(Counter)
        dr_counter = Counter()
        # {date_str -> {'signups': int, 'clubs': set}}
        daily: dict = {}

        for doc in docs:
            data = doc.to_dict() or {}

            # Skip test data
            if data.get('isTestData'):
                continue

            # Always tally registration status (all users)
            reg = data.get('registration') or {}
            status = reg.get('status', 'draft')
            reg_status_counter[status] += 1

            if status != 'complete':
                continue

            total += 1

            # Time series: use dataPolicy.acceptedAt as the signup completion timestamp
            # (createdAt is not reliably set on user docs; acceptedAt is always present
            # for completed signups since accepting the data policy is required)
            accepted_at = (data.get('registration') or {}).get('dataPolicy', {}).get('acceptedAt')
            if accepted_at is not None:
                try:
                    import datetime
                    if hasattr(accepted_at, 'date'):
                        day = accepted_at.date().isoformat()
                    else:
                        day = datetime.date.fromtimestamp(int(accepted_at)).isoformat()
                    if day not in daily:
                        daily[day] = {'signups': 0, 'clubs': set()}
                    daily[day]['signups'] += 1
                    club_val = (data.get('club') or '').strip()
                    if club_val:
                        daily[day]['clubs'].add(club_val)
                except Exception:
                    logger.warning('Failed to parse acceptedAt for user %s', doc.id, exc_info=True)

            # Club
            club = (data.get('club') or '').strip()
            if club:
                club_counter[club] += 1
            else:
                club_counter['Unknown'] += 1

            # Liga category (effective assigned category)
            liga = data.get('ligaCategory') or {}
            if liga.get('locked') and liga.get('category'):
                cat = liga['category']
                locked_count += 1
            else:
                auto = liga.get('autoAssigned') or {}
                self_sel = liga.get('selfSelected') or {}
                if self_sel.get('category'):
                    cat = self_sel['category']
                    self_selected_count += 1
                elif auto.get('category'):
                    cat = auto['category']
                else:
                    cat = 'Unassigned'
            category_counter[cat] += 1

            # Trainer type (+ dual-recording requirement, cross-tabbed by category)
            equipment = data.get('equipment') or {}
            trainer = (equipment.get('trainer') or '').strip()
            trainer_label = trainer if trainer else 'Unknown'
            trainer_counter[trainer_label] += 1
            trainer_by_category[cat][trainer_label] += 1

            # Riders whose trainer is missing or not in the trainers catalog cannot be
            # classified, so they get their own bucket rather than counting as "not required".
            requires_dual = trainer_dr_map.get(_normalize_trainer_name(trainer)) if trainer else None
            if requires_dual is None:
                dr_bucket = DR_UNKNOWN
            elif requires_dual:
                dr_bucket = DR_REQUIRED
            else:
                dr_bucket = DR_NOT_REQUIRED
            trainer_dr_bucket[trainer_label] = dr_bucket
            dr_counter[dr_bucket] += 1
            dr_by_category[cat][dr_bucket] += 1

            # Verification status
            verification = data.get('verification') or {}
            ver_status = verification.get('status', 'none')
            verification_counter[ver_status] += 1

            # Phenotype
            zr = data.get('zwiftRacing') or {}
            phenotype = (zr.get('phenotype') or '').strip()
            if phenotype:
                phenotype_counter[phenotype] += 1

        # Load league settings for context
        try:
            settings_doc = db.collection('league').document('settings').get()
            settings = settings_doc.to_dict() if settings_doc.exists else {}
        except Exception:
            settings = {}

        liga_categories = settings.get('ligaCategories') or []
        cat_order = [c['name'] for c in liga_categories] if liga_categories else []

        # Sort category distribution by configured order
        def cat_sort_key(item):
            try:
                return cat_order.index(item['category'])
            except (ValueError, KeyError):
                return len(cat_order)

        category_dist = sorted(
            [{'category': k, 'count': v} for k, v in category_counter.items()],
            key=cat_sort_key
        )

        # Top clubs (sorted by count descending)
        club_dist = sorted(
            [{'club': k, 'count': v} for k, v in club_counter.items()],
            key=lambda x: -x['count']
        )

        trainer_dist = sorted(
            [
                {
                    'trainer': k,
                    'count': v,
                    'dualRecording': trainer_dr_bucket.get(k, DR_UNKNOWN),
                }
                for k, v in trainer_counter.items()
            ],
            key=lambda x: -x['count']
        )

        # Trainer types cross-tabbed by liga category
        trainer_by_category_dist = sorted(
            [
                {
                    'category': category,
                    'total': sum(counter.values()),
                    'trainers': sorted(
                        [
                            {
                                'trainer': name,
                                'count': count,
                                'dualRecording': trainer_dr_bucket.get(name, DR_UNKNOWN),
                            }
                            for name, count in counter.items()
                        ],
                        key=lambda x: -x['count']
                    ),
                }
                for category, counter in trainer_by_category.items()
            ],
            key=cat_sort_key
        )

        # Dual-recording requirement, overall and per liga category
        dual_recording_dist = [
            {'bucket': bucket, 'count': dr_counter.get(bucket, 0)}
            for bucket in (DR_REQUIRED, DR_NOT_REQUIRED, DR_UNKNOWN)
        ]

        dual_recording_by_category = sorted(
            [
                {
                    'category': category,
                    DR_REQUIRED: counter.get(DR_REQUIRED, 0),
                    DR_NOT_REQUIRED: counter.get(DR_NOT_REQUIRED, 0),
                    DR_UNKNOWN: counter.get(DR_UNKNOWN, 0),
                    'total': sum(counter.values()),
                }
                for category, counter in dr_by_category.items()
            ],
            key=cat_sort_key
        )

        phenotype_dist = sorted(
            [{'phenotype': k, 'count': v} for k, v in phenotype_counter.items()],
            key=lambda x: -x['count']
        )

        # Build cumulative time series sorted by date
        seen_clubs: set = set()
        cumulative_signups = 0
        growth_series = []
        for day in sorted(daily.keys()):
            cumulative_signups += daily[day]['signups']
            seen_clubs |= daily[day]['clubs']
            growth_series.append({
                'date': day,
                'signups': cumulative_signups,
                'clubs': len(seen_clubs),
            })

        return jsonify({
            'total': total,
            'growthSeries': growth_series,
            'registrationStatus': [
                {'status': k, 'count': v}
                for k, v in reg_status_counter.most_common()
            ],
            'categoryDistribution': category_dist,
            'clubDistribution': club_dist,
            'trainerDistribution': trainer_dist,
            'trainerByCategory': trainer_by_category_dist,
            'dualRecordingDistribution': dual_recording_dist,
            'dualRecordingByCategory': dual_recording_by_category,
            'verificationStatus': [
                {'status': k, 'count': v}
                for k, v in verification_counter.most_common()
            ],
            'phenotypeDistribution': phenotype_dist,
            'lockedCount': locked_count,
            'selfSelectedCount': self_selected_count,
            'clubCount': len([c for c in club_counter if c != 'Unknown']),
            'seasonStart': settings.get('seasonStart'),
            'leagueName': settings.get('name'),
        })

    except Exception as e:
        logger.exception('Error fetching league stats')
        return jsonify({'error': str(e)}), 500
