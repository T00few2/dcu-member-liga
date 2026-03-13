"""
Flask route decorators for authentication and common guards.

Usage:
    from utils.decorators import admin_required, auth_required, db_required

    @races_bp.route('/admin/foo', methods=['POST'])
    @admin_required
    def my_admin_endpoint():
        ...

    @users_bp.route('/profile', methods=['GET'])
    @auth_required
    def my_user_endpoint(decoded_token):
        uid = decoded_token['uid']
        ...
"""
from __future__ import annotations

from functools import wraps
from flask import request, jsonify
from authz import require_admin as _require_admin, verify_user_token, AuthzError


def admin_required(f):
    """Require a valid Firebase ID token with admin == True."""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            _require_admin(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code
        return f(*args, **kwargs)
    return decorated


def auth_required(f):
    """
    Require a valid Firebase ID token.
    Injects the decoded token dict as the first positional argument.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            decoded = verify_user_token(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code
        return f(decoded, *args, **kwargs)
    return decorated


def db_required(f):
    """Return 500 immediately if the Firestore client is unavailable."""
    @wraps(f)
    def decorated(*args, **kwargs):
        from extensions import db  # deferred to avoid circular import at module load
        if not db:
            return jsonify({'error': 'DB not available'}), 500
        return f(*args, **kwargs)
    return decorated
