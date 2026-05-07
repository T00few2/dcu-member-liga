"""
Compatibility entrypoint for legacy liga-category routes module path.
"""

# Route modules register endpoints on `admin_bp` at import time.
# flake8: noqa: E402, F401
import routes.admin_liga_categories_refresh_routes  # noqa: E402, F401
import routes.admin_liga_categories_management_routes  # noqa: E402, F401
