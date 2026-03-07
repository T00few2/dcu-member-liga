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

# Validate essential config
if not STRAVA_CLIENT_ID or not STRAVA_CLIENT_SECRET:
    logger.warning("Warning: STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET is missing.")

if not ZWIFT_USERNAME or not ZWIFT_PASSWORD:
    logger.warning("Warning: ZWIFT_USERNAME or ZWIFT_PASSWORD is missing.")

if not ZR_AUTH_KEY:
    logger.warning("Warning: ZR_AUTH_KEY is missing. ZwiftRacing integration will fail.")
