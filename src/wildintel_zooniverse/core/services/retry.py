"""Retries shared by uploads and downloads — tenacity, as wildintel-tools
uses: exponential backoff, and a way to stop waiting when the user presses
Stop."""
from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass

import httpx
from tenacity import Retrying, before_sleep_log, retry_if_exception, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class Stopped(Exception):
    """The run was stopped before this step could (re)start."""


@dataclass(frozen=True)
class RetryPolicy:
    attempts: int
    # Exponential backoff between attempts, in seconds: min_wait, twice
    # that, four times... up to max_wait.
    min_wait: float
    max_wait: float

    @classmethod
    def from_delay(cls, attempts: int, delay: float) -> RetryPolicy:
        return cls(attempts=attempts, min_wait=delay, max_wait=delay * 16)

    def call(self, fn: Callable, *args, retry_if: Callable[[BaseException], bool], cancel: threading.Event):
        """fn(*args), retried while retry_if says the error may go away. Once
        `cancel` is set (the run was stopped), a wait between attempts ends
        at once and no further attempt starts — Stopped is raised instead."""
        def attempt():
            if cancel.is_set():
                raise Stopped("Stopped.")
            return fn(*args)

        return self._retrying(retry_if, cancel)(attempt)

    def _retrying(self, retry_if: Callable[[BaseException], bool], cancel: threading.Event) -> Retrying:
        return Retrying(
            reraise=True,
            stop=stop_after_attempt(self.attempts) | (lambda _state: cancel.is_set()),
            wait=wait_exponential(multiplier=self.min_wait, min=self.min_wait, max=self.max_wait),
            retry=retry_if_exception(retry_if),
            sleep=cancel.wait,
            before_sleep=before_sleep_log(logger, logging.WARNING),
        )


def download_retryable(exc: BaseException) -> bool:
    """Network failures and server-side errors — never a 4xx (a missing
    file stays missing)."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500 or exc.response.status_code == 429
    return isinstance(exc, httpx.TransportError)
