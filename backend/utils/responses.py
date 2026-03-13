"""
Standard HTTP response helpers.

Usage:
    from utils.responses import ok, created, bad_request, not_found, error_response

All helpers return a (flask.Response, int) tuple compatible with Flask route returns.
"""
from flask import jsonify


def ok(data: dict | None = None, message: str | None = None):
    payload = data or {}
    if message:
        payload = {**payload, 'message': message}
    return jsonify(payload), 200


def created(data: dict | None = None, message: str | None = None):
    payload = data or {}
    if message:
        payload = {**payload, 'message': message}
    return jsonify(payload), 201


def bad_request(message: str):
    return jsonify({'message': message}), 400


def unauthorized(message: str = 'Unauthorized'):
    return jsonify({'message': message}), 401


def forbidden(message: str = 'Forbidden'):
    return jsonify({'message': message}), 403


def not_found(message: str = 'Not found'):
    return jsonify({'message': message}), 404


def error_response(message: str, status_code: int = 500):
    return jsonify({'message': message}), status_code


def db_unavailable():
    return jsonify({'error': 'DB not available'}), 500
