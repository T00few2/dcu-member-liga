import os
import functions_framework
from flask import Flask, request as flask_request
from urllib.parse import urlparse
from extensions import db
from routes.races import races_bp
from routes.league import league_bp
from routes.users import users_bp
from routes.admin import admin_bp
from routes.integration import integration_bp
from routes.seed import seed_bp
from routes.policy import policy_bp
from utils.logging_setup import configure_logging

# ---------------------------------------------------------------------------
# Configure structured logging before anything else.
# Set LOG_FORMAT=json in the environment for GCP Cloud Logging JSON output.
# ---------------------------------------------------------------------------
configure_logging()

# ---------------------------------------------------------------------------
# CORS configuration
#
# ALLOWED_ORIGINS: comma-separated list of allowed origins (no trailing slash).
# Defaults to the production domains. Set via environment variable to add
# preview/staging origins without changing code.
# ---------------------------------------------------------------------------
_allowed_origins_env = os.environ.get(
    'ALLOWED_ORIGINS',
    'https://dansk-ecykling.dk,https://www.dansk-ecykling.dk',
)
ALLOWED_ORIGINS = {o.strip() for o in _allowed_origins_env.split(',') if o.strip()}

_ALLOW_LOCALHOST = os.environ.get('ALLOW_LOCALHOST', 'false').lower() == 'true'
_SEED_ENABLED = os.environ.get('SEED_ENABLED', 'false').lower() == 'true'


def _is_local_dev_origin(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
    except Exception:
        return False

    if parsed.scheme not in {'http', 'https'}:
        return False

    host = (parsed.hostname or '').lower()
    if host in {'localhost', '127.0.0.1', '::1'}:
        return True

    if host.startswith('192.168.') or host.startswith('10.'):
        return True
    if host.startswith('172.'):
        parts = host.split('.')
        if len(parts) >= 2 and parts[1].isdigit() and 16 <= int(parts[1]) <= 31:
            return True

    return False


def get_cors_origin(origin: str | None) -> str | None:
    if not origin:
        return None
    if origin in ALLOWED_ORIGINS:
        return origin
    if _ALLOW_LOCALHOST and _is_local_dev_origin(origin):
        return origin
    return None


def create_app():
    app = Flask(__name__)

    app.register_blueprint(races_bp)
    app.register_blueprint(league_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(integration_bp)
    if _SEED_ENABLED:
        app.register_blueprint(seed_bp)
    app.register_blueprint(policy_bp)
    from routes.verification import verification_bp
    app.register_blueprint(verification_bp)

    @app.after_request
    def after_request(response):
        origin = flask_request.headers.get('Origin')
        allowed = get_cors_origin(origin)
        if allowed:
            response.headers['Access-Control-Allow-Origin'] = allowed
            response.headers['Vary'] = 'Origin'
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response

    return app


app = create_app()


@functions_framework.http
def dcu_api(request):
    """HTTP Cloud Function entry point — dispatches to the Flask app."""
    if request.method == 'OPTIONS':
        origin = request.headers.get('Origin', '')
        allowed = get_cors_origin(origin)
        if not allowed:
            return ('', 403, {})
        headers = {
            'Access-Control-Allow-Origin': allowed,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '3600',
            'Vary': 'Origin',
        }
        return ('', 204, headers)

    with app.request_context(request.environ):
        try:
            rv = app.preprocess_request()
            if rv is None:
                rv = app.dispatch_request()
            response = app.make_response(rv)
            response = app.process_response(response)
            return response
        except Exception as e:
            return app.handle_user_exception(e)
