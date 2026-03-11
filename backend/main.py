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

ALLOWED_ORIGINS = {'https://dansk-ecykling.dk', 'https://www.dansk-ecykling.dk'}
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

    # Permit private network hosts for LAN testing in local dev.
    if host.startswith('192.168.') or host.startswith('10.'):
        return True
    if host.startswith('172.'):
        parts = host.split('.')
        if len(parts) >= 2 and parts[1].isdigit():
            second = int(parts[1])
            if 16 <= second <= 31:
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
    
    # Register Blueprints
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
    
    # Add CORS headers to all responses
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

# Initialize the Flask app
app = create_app()

@functions_framework.http
def dcu_api(request):
    """
    HTTP Cloud Function entry point that dispatches to the Flask app.
    Args:
        request (flask.Request): The request object.
        <https://flask.palletsprojects.com/en/1.1.x/api/#incoming-request-data>
    Returns:
        The response text, or any set of values that can be turned into a
        Response object using `make_response`
        <https://flask.palletsprojects.com/en/1.1.x/api/#flask.make_response>.
    """
    # Handle CORS preflight options request directly if needed, 
    # but Flask routes usually handle OPTIONS if configured.
    # However, global CORS handling in `after_request` handles the headers,
    # but Flask might 405 an OPTIONS request if not explicitly defined on routes.
    # To be safe for "Global OPTIONS", we can check here.
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

    # Dispatch to Flask
    # request.environ is a WSGI environment dictionary
    with app.request_context(request.environ):
        try:
            # Preprocess request (signals, url matching)
            rv = app.preprocess_request()
            if rv is None:
                # Dispatch to view
                rv = app.dispatch_request()
            
            # Create response
            response = app.make_response(rv)
            response = app.process_response(response)
            return response
        except Exception as e:
            return app.handle_user_exception(e)
