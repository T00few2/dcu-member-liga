import os
from dotenv import load_dotenv

load_dotenv()

STRAVA_CLIENT_ID = os.getenv('STRAVA_CLIENT_ID')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET')
BACKEND_URL = os.getenv('BACKEND_URL', 'https://us-central1-dcu-member-liga-479507.cloudfunctions.net/dcu_api')

# Validate essential config
if not STRAVA_CLIENT_ID or not STRAVA_CLIENT_SECRET:
    print("Warning: STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET is missing.")

