"""Plan catalogue and capability -> meter metric mapping.

Limits are per period per account. ``None`` means unlimited. The first release
supports personal-learner plans only (free / trial / pro); organization
tenants and seats are explicitly out of scope.
"""

from __future__ import annotations

from enum import StrEnum


class CapabilityMetric(StrEnum):
    RESEARCH = "research"
    VISUALIZATION = "visualization"
    QUESTION = "question"
    SOLVE = "solve"
    JUDGE = "judge"
    MEDIA = "media"
    PRACTICE = "practice"
    MASTERY = "mastery"


#: Capability/job name -> billable metric.
_CAPABILITY_METRIC: dict[str, CapabilityMetric] = {
    "deep_research": CapabilityMetric.RESEARCH,
    "visualize": CapabilityMetric.VISUALIZATION,
    "deep_question": CapabilityMetric.QUESTION,
    "problem_solve": CapabilityMetric.SOLVE,
    "quiz_judge": CapabilityMetric.JUDGE,
    "audio_overview": CapabilityMetric.MEDIA,
    "mastery_path": CapabilityMetric.MASTERY,
}


def metric_for_capability(capability: str) -> CapabilityMetric:
    return _CAPABILITY_METRIC.get(capability, CapabilityMetric.PRACTICE)


QUOTA_PERIODS = ("day", "month")

#: plan -> period -> metric -> max units (None = unlimited)
PLAN_LIMITS: dict[str, dict[str, dict[str, int | None]]] = {
    "free": {
        "day": {
            CapabilityMetric.RESEARCH: 10,
            CapabilityMetric.VISUALIZATION: 30,
            CapabilityMetric.QUESTION: 50,
            CapabilityMetric.SOLVE: 20,
            CapabilityMetric.JUDGE: 20,
            CapabilityMetric.MEDIA: 3,
            CapabilityMetric.PRACTICE: 300,
            CapabilityMetric.MASTERY: 300,
        },
        "month": {
            CapabilityMetric.RESEARCH: 100,
            CapabilityMetric.VISUALIZATION: 300,
            CapabilityMetric.QUESTION: 500,
            CapabilityMetric.SOLVE: 300,
            CapabilityMetric.JUDGE: 200,
            CapabilityMetric.MEDIA: 30,
            CapabilityMetric.PRACTICE: 5000,
            CapabilityMetric.MASTERY: 5000,
        },
    },
    "trial": {
        "day": {
            CapabilityMetric.RESEARCH: 30,
            CapabilityMetric.VISUALIZATION: 100,
            CapabilityMetric.QUESTION: 200,
            CapabilityMetric.SOLVE: 100,
            CapabilityMetric.JUDGE: 100,
            CapabilityMetric.MEDIA: 10,
            CapabilityMetric.PRACTICE: 1000,
            CapabilityMetric.MASTERY: 1000,
        },
        "month": {},
    },
    "pro": {"day": {}, "month": {}},
}


def plan_limit(plan: str, period: str, metric: str) -> int | None:
    plan_table = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    return plan_table.get(period, {}).get(metric)
