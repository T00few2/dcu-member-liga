"""
Admin routes package entry-point.

Defines the single `admin_bp` Blueprint and then imports sub-modules to
register routes on it.  The deferred imports at the bottom of this file are
intentional: each sub-module does `from routes.admin import admin_bp`, which
works because admin_bp is fully defined before the imports are executed
(Python returns the partially-initialised module from sys.modules).

Sub-module responsibilities
---------------------------
admin_verification_profile_routes – /admin/verification/* rider/profile/activity-list endpoints
admin_verification_dual_routes    – /admin/verification/* dual-recording + race batch endpoints
admin_trainers        – /trainers/* (CRUD + approval workflow)
admin_liga_categories_refresh_routes – refresh/sync endpoints for ZR + Zwift profile
admin_liga_categories_management_routes – liga category config/assign/reassign/predictor endpoints
admin_season          – /admin/archive-season, /admin/reset-season
"""
from flask import Blueprint

admin_bp = Blueprint('admin', __name__)

# Sub-module imports MUST come after admin_bp is defined.
# flake8: noqa: E402, F401
import routes.admin_verification_profile_routes  # noqa: E402, F401
import routes.admin_verification_dual_routes  # noqa: E402, F401
import routes.admin_trainers        # noqa: E402, F401
import routes.admin_liga_categories_refresh_routes  # noqa: E402, F401
import routes.admin_liga_categories_management_routes  # noqa: E402, F401
import routes.admin_season          # noqa: E402, F401
import routes.admin_stats           # noqa: E402, F401
import routes.admin_users           # noqa: E402, F401
