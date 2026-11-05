"""Start the bot: `python -m bot`."""
from __future__ import annotations

import logging

from bot.client import DcuBot
from bot.config import load


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load()
    DcuBot(config).run(config.token, log_handler=None)


if __name__ == "__main__":
    main()
