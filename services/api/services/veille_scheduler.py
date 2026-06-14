"""Veille scheduler — background asyncio task for automatic tender monitoring.

Runs a periodic loop (every 60 s) that opens a database session and checks
whether the veille is due to run.  If it is (``enabled=True``, current time
past ``next_run_at``, and outside the quiet window), it delegates to
:func:`services.veille.run_veille`.

The loop is designed to be completely indestructible: any exception — including
database connectivity issues or unexpected errors inside ``run_veille`` — is
caught and logged, and the loop keeps going.

Usage (from ``main.py`` lifespan)::

    from services.veille_scheduler import scheduler

    # On startup:
    await scheduler.start()

    # On shutdown:
    await scheduler.stop()
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger("openclaw.veille_scheduler")

# How often the scheduler wakes up to check whether a run is due (seconds).
_POLL_INTERVAL: int = 60


class VeilleScheduler:
    """Background asyncio scheduler for the veille (tender-watch) service.

    Instantiate once at module level and call :meth:`start` / :meth:`stop`
    from the FastAPI lifespan.

    Attributes:
        _task: the running asyncio Task, or ``None`` when stopped.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the scheduler background task.

        Safe to call multiple times: if a task is already running it will not
        be replaced.
        """
        if self._task is not None and not self._task.done():
            logger.debug("VeilleScheduler already running; start() is a no-op.")
            return

        self._task = asyncio.create_task(
            self._loop(), name="veille_scheduler"
        )
        logger.info("VeilleScheduler started (poll interval: %ds).", _POLL_INTERVAL)

    async def stop(self) -> None:
        """Cancel the scheduler background task and wait for it to finish."""
        if self._task is None or self._task.done():
            return

        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

        logger.info("VeilleScheduler stopped.")

    async def _loop(self) -> None:
        """Main scheduler loop — wakes up every ``_POLL_INTERVAL`` seconds.

        Opens a fresh async session on each iteration so that the session is
        never held open between ticks.  The broad ``except`` at the outer level
        ensures the task never silently dies.
        """
        logger.debug("VeilleScheduler loop entered.")

        while True:
            try:
                await asyncio.sleep(_POLL_INTERVAL)
                await self._tick()
            except asyncio.CancelledError:
                # Propagate cancellation so stop() can await us cleanly.
                raise
            except Exception:  # noqa: BLE001 — loop must never die
                logger.exception(
                    "VeilleScheduler encountered an unexpected error; "
                    "resuming in %ds.",
                    _POLL_INTERVAL,
                )

    async def _tick(self) -> None:
        """Single scheduler tick: check config and run veille if due.

        All imports that might fail (models, services) are deferred inside this
        method so that an ImportError at boot time does not prevent startup.
        """
        try:
            from database import async_session_maker  # deferred to survive import errors
            from services.veille import get_or_create_config, is_quiet, run_veille
        except ImportError:
            logger.warning(
                "VeilleScheduler: services.veille not yet available; skipping tick."
            )
            return

        try:
            async with async_session_maker() as db:
                config = await get_or_create_config(db)

                if not config.enabled:
                    return

                now = datetime.now(tz=timezone.utc)

                # Check quiet hours (évaluées dans le fuseau de config) avant
                # next_run_at, pour ne jamais déclencher en plage silencieuse.
                if is_quiet(config, now):
                    logger.debug(
                        "VeilleScheduler: inside quiet window (%s-%s); skipping.",
                        config.quiet_start,
                        config.quiet_end,
                    )
                    return

                # next_run_at may be None on first enable — treat that as "due now".
                next_run = config.next_run_at
                if next_run is not None:
                    # Normalise to aware datetime for comparison.
                    if next_run.tzinfo is None:
                        next_run = next_run.replace(tzinfo=timezone.utc)
                    if now < next_run:
                        return

                logger.info("VeilleScheduler: veille is due — running now.")
                result = await run_veille(db)
                logger.info(
                    "VeilleScheduler: run complete — %d new offer(s).",
                    result.get("count", 0),
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — tick must never crash the loop
            logger.exception("VeilleScheduler: error during tick; will retry next poll.")


# Module-level singleton consumed by main.py lifespan.
scheduler = VeilleScheduler()
