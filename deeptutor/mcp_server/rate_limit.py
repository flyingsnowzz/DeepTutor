"""Tiny in-process sliding-window rate limiter.

Single-instance deployments (the T3 trial target) are fully covered. Multi
instance deployments should back this with Redis (REDIS_URL) — the interface is
deliberately tiny so the implementation can be swapped without touching callers.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
import time


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: float


class SlidingWindowRateLimiter:
    def __init__(self):
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, *, limit: int, window_seconds: float = 60.0) -> RateLimitDecision:
        now = time.monotonic()
        events = self._events[key]
        cutoff = now - window_seconds
        while events and events[0] < cutoff:
            events.popleft()
        if len(events) >= limit:
            retry_after = max(0.1, events[0] + window_seconds - now)
            return RateLimitDecision(False, limit, 0, round(retry_after, 2))
        events.append(now)
        return RateLimitDecision(True, limit, limit - len(events), 0.0)
