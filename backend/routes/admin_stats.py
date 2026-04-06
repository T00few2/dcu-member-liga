"""
Admin: League statistics overview.

Provides aggregated stats for the admin stats dashboard tab.
Registered on admin_bp (defined in routes/admin.py).
"""
from flask import request, jsonify
from collections import Counter

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db

import logging

logger = logging.getLogger(__name__)


@admin_bp.route('/admin/stats', methods=['GET'])
def get_league_stats():
    """Return aggregated league statistics."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    try:
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

        for doc in docs:
            data = doc.to_dict() or {}

            # Skip test data
            if data.get('isTestData'):
                continue

            total += 1

            # Registration status
            reg = data.get('registration') or {}
            status = reg.get('status', 'draft')
            reg_status_counter[status] += 1

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

            # Trainer type
            equipment = data.get('equipment') or {}
            trainer = (equipment.get('trainer') or '').strip()
            trainer_counter[trainer if trainer else 'Unknown'] += 1

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
                return cat_order.index(item[0])
            except ValueError:
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
            [{'trainer': k, 'count': v} for k, v in trainer_counter.items()],
            key=lambda x: -x['count']
        )

        phenotype_dist = sorted(
            [{'phenotype': k, 'count': v} for k, v in phenotype_counter.items()],
            key=lambda x: -x['count']
        )

        return jsonify({
            'total': total,
            'registrationStatus': [
                {'status': k, 'count': v}
                for k, v in reg_status_counter.most_common()
            ],
            'categoryDistribution': category_dist,
            'clubDistribution': club_dist,
            'trainerDistribution': trainer_dist,
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
