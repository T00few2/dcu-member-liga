"""
Admin routes package entry-point.

Defines the single `admin_bp` Blueprint and then imports sub-modules to
register routes on it.  The deferred imports at the bottom of this file are
intentional: each sub-module does `from routes.admin import admin_bp`, which
works because admin_bp is fully defined before the imports are executed
(Python returns the partially-initialised module from sys.modules).

Sub-module responsibilities
---------------------------
admin_verification    – /admin/verification/* (rider data, Strava streams)
admin_trainers        – /trainers/* (CRUD + approval workflow)
admin_liga_categories – /admin/liga-categories/* + /admin/assign-liga-categories
                        + /admin/refresh-zr-stats
admin_season          – /admin/archive-season, /admin/reset-season
"""
from flask import Blueprint

admin_bp = Blueprint('admin', __name__)

# Sub-module imports MUST come after admin_bp is defined.
# flake8: noqa: E402, F401
import routes.admin_verification    # noqa: E402, F401
import routes.admin_trainers        # noqa: E402, F401
import routes.admin_liga_categories # noqa: E402, F401
import routes.admin_season          # noqa: E402, F401
import routes.admin_stats           # noqa: E402, F401
import routes.admin_users           # noqa: E402, F401
