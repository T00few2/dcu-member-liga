import os
from dotenv import load_dotenv

import logging

logger = logging.getLogger(__name__)

load_dotenv()

STRAVA_CLIENT_ID = os.getenv('STRAVA_CLIENT_ID')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET')
BACKEND_URL = os.getenv('BACKEND_URL', 'https://us-central1-dcu-member-liga-479507.cloudfunctions.net/dcu_api')
FRONTEND_URL = os.getenv('FRONTEND_URL', 'https://dcu-member-liga.vercel.app')

ZWIFT_USERNAME = os.getenv('ZWIFT_USERNAME')
ZWIFT_PASSWORD = os.getenv('ZWIFT_PASSWORD')

ZR_AUTH_KEY = os.getenv('ZR_AUTH_KEY')
ZR_BASE_URL = os.getenv('ZR_BASE_URL', 'https://api.zwiftracing.app/api')

# Critical secrets — raise immediately so the app fails loudly at startup
_required = [(n, v) for n, v in [('ZWIFT_USERNAME', ZWIFT_USERNAME), ('ZWIFT_PASSWORD', ZWIFT_PASSWORD)] if not v]
if _required:
    raise ValueError(
        f"Required config missing: {', '.join(n for n, _ in _required)}. "
        "Set these variables in your .env file before starting the server."
    )

# Optional integrations — warn but allow startup without them
for _name, _val, _hint in [
    ('STRAVA_CLIENT_ID', STRAVA_CLIENT_ID, 'Strava OAuth will be unavailable.'),
    ('STRAVA_CLIENT_SECRET', STRAVA_CLIENT_SECRET, 'Strava OAuth will be unavailable.'),
    ('ZR_AUTH_KEY', ZR_AUTH_KEY, 'ZwiftRacing integration will fail.'),
]:
    if not _val:
        logger.warning(f"Optional config '{_name}' is not set. {_hint}")
