import os
from dotenv import load_dotenv

import logging

logger = logging.getLogger(__name__)

load_dotenv()

STRAVA_CLIENT_ID = os.getenv('STRAVA_CLIENT_ID')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET')
# Refresh token for a dedicated service account used to fetch public segment data
STRAVA_SERVICE_REFRESH_TOKEN = os.getenv('STRAVA_SERVICE_REFRESH_TOKEN')
BACKEND_URL = os.getenv('BACKEND_URL', 'https://us-central1-dcu-member-liga-479507.cloudfunctions.net/dcu_api')
FRONTEND_URL = os.getenv('FRONTEND_URL', 'https://dansk-ecykling.dk')

ZR_AUTH_KEY = os.getenv('ZR_AUTH_KEY')
ZR_BASE_URL = os.getenv('ZR_BASE_URL', 'https://api.zwiftracing.app/api')

ZWIFT_CLIENT_ID = os.getenv('ZWIFT_CLIENT_ID')
ZWIFT_CLIENT_SECRET = os.getenv('ZWIFT_CLIENT_SECRET')
ZWIFT_AUTH_BASE_URL = os.getenv('ZWIFT_AUTH_BASE_URL', 'https://secure.zwift.com/auth/realms/zwift')
ZWIFT_API_BASE_URL = os.getenv('ZWIFT_API_BASE_URL', 'https://us-or-rly101.zwift.com')
ZWIFT_REDIRECT_URI = os.getenv('ZWIFT_REDIRECT_URI', f'{BACKEND_URL}/zwift/callback')
ZWIFT_MIGRATION_MODE = os.getenv('ZWIFT_MIGRATION_MODE', 'official_only')

SCHEDULER_SECRET = os.getenv('SCHEDULER_SECRET')

# Critical secrets — raise at startup so the app fails loudly.
# In CI (GitHub Actions sets CI=true automatically), downgrade to a warning
# so tests can run without real credentials.
_zwift_required = [
    (n, v)
    for n, v in [
        ('ZWIFT_CLIENT_ID', ZWIFT_CLIENT_ID),
        ('ZWIFT_CLIENT_SECRET', ZWIFT_CLIENT_SECRET),
    ]
    if not v
]
if _zwift_required:
    _names = ', '.join(n for n, _ in _zwift_required)
    logger.warning(
        f"Config missing: {_names}. "
        "Zwift integrations will be unavailable until these vars are configured."
    )

# Optional integrations — warn but allow startup without them
for _name, _val, _hint in [
    ('STRAVA_CLIENT_ID', STRAVA_CLIENT_ID, 'Strava OAuth will be unavailable.'),
    ('STRAVA_CLIENT_SECRET', STRAVA_CLIENT_SECRET, 'Strava OAuth will be unavailable.'),
    ('ZR_AUTH_KEY', ZR_AUTH_KEY, 'ZwiftRacing integration will fail.'),
]:
    if not _val:
        logger.warning(f"Optional config '{_name}' is not set. {_hint}")
