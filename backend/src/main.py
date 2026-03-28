"""
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
"""

import logging
import sys

from src.config_reader import load_settings
from src.api import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    stream=sys.stdout,
)


settings = load_settings()
app = create_app(settings)


def main() -> None:
    """Run with uvicorn when executed as `python -m src.main`."""
    import uvicorn

    uvicorn.run(
        "src.main:app",
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()