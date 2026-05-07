from flask import Blueprint

users_bp = Blueprint("users", __name__)

"""
Compatibility entrypoint for users routes.
This keeps the historical import path (`routes.users`) while route
implementations are split across focused modules.
"""
import routes.users_profile_routes  # noqa: E402, F401
import routes.users_stats_routes  # noqa: E402, F401
