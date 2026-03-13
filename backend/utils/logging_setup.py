"""
Structured logging configuration.

Call configure_logging() once at application startup (in main.py).

Set LOG_FORMAT=json in the environment to emit JSON-structured logs, which
Google Cloud Logging parses automatically. The default is human-readable text.
Set LOG_LEVEL=DEBUG|INFO|WARNING|ERROR to control verbosity (default: INFO).
"""
from __future__ import annotations

import json
import logging
import os


class _JsonFormatter(logging.Formatter):
    """Emit each log record as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            'severity': record.levelname,
            'message': record.getMessage(),
            'logger': record.name,
            'module': record.module,
        }
        if record.exc_info:
            entry['exc_info'] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure_logging(level: str | None = None) -> None:
    """
    Configure the root logger.

    Safe to call multiple times — adds a handler only if none are present.
    """
    root = logging.getLogger()
    if root.handlers:
        return  # Already configured (e.g. by test runner or framework)

    handler = logging.StreamHandler()
    if os.environ.get('LOG_FORMAT', '').lower() == 'json':
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
        )
    root.addHandler(handler)

    effective_level = level or os.environ.get('LOG_LEVEL', 'INFO').upper()
    root.setLevel(getattr(logging, effective_level, logging.INFO))
