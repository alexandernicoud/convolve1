"""
Alembic environment: uses DATABASE_URL from app.config (same as the FastAPI app).

Run from the backend/ directory:
  alembic upgrade head
  alembic revision --autogenerate -m "description"
"""

from __future__ import annotations

import logging
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool

# Ensure `app` is importable when Alembic loads this file
import sys

_backend_root = Path(__file__).resolve().parents[1]
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from app.config import DATABASE_URL  # noqa: E402
from app.db import get_connect_args  # noqa: E402
from app.models import Base  # noqa: E402

config = context.config
target_metadata = Base.metadata

if config.config_file_name is not None:
    try:
        fileConfig(config.config_file_name)
    except FileNotFoundError:
        pass

logger = logging.getLogger("alembic.env")


def run_migrations_offline() -> None:
    url = DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        DATABASE_URL,
        poolclass=pool.NullPool,
        connect_args=get_connect_args(),
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
