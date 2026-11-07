"""Owner-scoped Question Bank card operations on PostgreSQL."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.core.assessment import (
    ASSESSMENT_RESULTS, ASSESSMENT_SOURCES, ASSESSMENT_TYPES,
)
from deeptutor.learning.assessment_postgres import _origin
from deeptutor.services.postgres.database import session_factory


class PostgresNotebookRepository:
    _categories_sql = """COALESCE((SELECT json_agg(json_build_object('id',nc.id,'name',nc.name)
        ORDER BY lower(nc.name)) FROM notebook_entry_categories ec
        JOIN notebook_categories nc ON nc.id=ec.category_id
          AND nc.owner_user_id=ec.owner_user_id
        WHERE ec.owner_user_id=c.owner_user_id AND ec.entry_id=c.id),'[]'::json)
        AS categories_json"""
    _practice_sql = """(SELECT json_build_object(
        'entry_id',r.entry_id,'is_mistake',r.is_mistake,
        'first_wrong_at',extract(epoch from r.first_wrong_at),
        'due_at',extract(epoch from r.due_at),
        'interval_days',r.interval_days,'ease',r.ease,'streak',r.streak,
        'lapses',r.lapses,'review_count',r.review_count,
        'last_review_at',extract(epoch from r.last_review_at),
        'version',r.version,
        'last_answer',(SELECT e.answer FROM notebook_practice_events e
           WHERE e.owner_user_id=r.owner_user_id AND e.entry_id=r.entry_id
           ORDER BY e.reviewed_at DESC,e.request_id DESC LIMIT 1),
        'last_rating',(SELECT e.rating FROM notebook_practice_events e
           WHERE e.owner_user_id=r.owner_user_id AND e.entry_id=r.entry_id
           ORDER BY e.reviewed_at DESC,e.request_id DESC LIMIT 1)
        ) FROM notebook_practice_state r
        WHERE r.owner_user_id=c.owner_user_id AND r.entry_id=c.id)
        AS practice_json"""
    def __init__(self, engine: AsyncEngine):
        self._sessions = session_factory(engine)

    async def navigation(self, owner: str) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT c.id,left(COALESCE(c.card_json->>'question',''),160) AS question,
                  c.created_at,c.updated_at
                FROM assessment_cards c LEFT JOIN sessions s
                  ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE c.owner_user_id=:owner AND s.deleted_at IS NULL
                ORDER BY c.updated_at DESC,c.id DESC
            """), {"owner": owner})).mappings().all()
        return [{"id": row["id"], "question": row["question"],
                 "created_at": row["created_at"].timestamp(),
                 "updated_at": row["updated_at"].timestamp()} for row in rows]

    async def create_category(self, owner: str, name: str) -> dict[str, Any]:
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("Category name is required")
        try:
            async with self._sessions() as db:
                row = (await db.execute(text("""
                    INSERT INTO notebook_categories (owner_user_id,name)
                    VALUES (:owner,:name) RETURNING id,name,created_at
                """), {"owner": owner, "name": cleaned})).mappings().one()
                await db.commit()
        except IntegrityError as exc:
            raise ValueError(f"A category named {cleaned!r} already exists.") from exc
        return {"id": row["id"], "name": row["name"],
                "created_at": row["created_at"].timestamp(), "entry_count": 0}

    async def list_categories(self, owner: str) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT c.id,c.name,c.created_at,
                  count(a.id) FILTER (WHERE s.deleted_at IS NULL) AS entry_count
                FROM notebook_categories c
                LEFT JOIN notebook_entry_categories ec
                  ON ec.category_id=c.id AND ec.owner_user_id=c.owner_user_id
                LEFT JOIN assessment_cards a
                  ON a.id=ec.entry_id AND a.owner_user_id=c.owner_user_id
                LEFT JOIN sessions s
                  ON s.id=a.session_id AND s.owner_user_id=a.owner_user_id
                WHERE c.owner_user_id=:owner
                GROUP BY c.id ORDER BY lower(c.name),c.id
            """), {"owner": owner})).mappings().all()
        return [{"id": row["id"], "name": row["name"],
                 "created_at": row["created_at"].timestamp(),
                 "entry_count": int(row["entry_count"])} for row in rows]

    async def find_category_by_name(self, owner: str, name: str) -> dict[str, Any] | None:
        cleaned = name.strip()
        async with self._sessions() as db:
            row = (await db.execute(text("""
                SELECT id,name,created_at FROM notebook_categories
                WHERE owner_user_id=:owner AND lower(name)=lower(:name)
                ORDER BY id LIMIT 1
            """), {"owner": owner, "name": cleaned})).mappings().first()
        return ({"id": row["id"], "name": row["name"],
                 "created_at": row["created_at"].timestamp()}
                if row is not None else None)

    async def rename_category(self, owner: str, category_id: int, name: str) -> bool:
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("Category name is required")
        try:
            async with self._sessions() as db:
                row = (await db.execute(text("""
                    UPDATE notebook_categories SET name=:name
                    WHERE id=:id AND owner_user_id=:owner RETURNING id
                """), {"owner": owner, "id": category_id, "name": cleaned})).scalar_one_or_none()
                await db.commit()
        except IntegrityError as exc:
            raise ValueError(f"A category named {cleaned!r} already exists.") from exc
        return row is not None

    async def delete_category(self, owner: str, category_id: int) -> bool:
        async with self._sessions() as db:
            row = (await db.execute(text("""
                DELETE FROM notebook_categories WHERE id=:id AND owner_user_id=:owner
                RETURNING id
            """), {"owner": owner, "id": category_id})).scalar_one_or_none()
            await db.commit()
        return row is not None

    async def link_entries(self, owner: str, entry_ids: list[int], category_id: int,
                           *, link: bool = True) -> int:
        if not entry_ids:
            return 0
        async with self._sessions() as db:
            if link:
                result = await db.execute(text("""
                    INSERT INTO notebook_entry_categories (owner_user_id,entry_id,category_id)
                    SELECT CAST(:owner AS varchar(64)),a.id,c.id FROM assessment_cards a
                    CROSS JOIN notebook_categories c
                    WHERE a.owner_user_id=:owner AND a.id=ANY(:entry_ids)
                      AND c.owner_user_id=:owner AND c.id=:category_id
                    ON CONFLICT DO NOTHING RETURNING entry_id
                """), {"owner": owner, "entry_ids": list(set(entry_ids)),
                       "category_id": category_id})
            else:
                result = await db.execute(text("""
                    DELETE FROM notebook_entry_categories
                    WHERE owner_user_id=:owner AND entry_id=ANY(:entry_ids)
                      AND category_id=:category_id RETURNING entry_id
                """), {"owner": owner, "entry_ids": list(set(entry_ids)),
                       "category_id": category_id})
            count = len(result.all())
            await db.commit()
        return count

    async def stats(self, owner_user_id: str) -> dict[str, int]:
        async with self._sessions() as db:
            row = (await db.execute(text("""
                SELECT count(*) AS total,
                  count(*) FILTER (WHERE COALESCE((c.card_json->>'is_correct')::boolean,false)=false
                    AND COALESCE(c.card_json->>'result','') NOT IN ('ungraded','voided')) AS wrong,
                  count(*) FILTER (WHERE COALESCE((c.card_json->>'is_correct')::boolean,false)=false
                    AND COALESCE((c.card_json->>'resolved')::boolean,false)=false
                    AND COALESCE(c.card_json->>'result','') NOT IN ('ungraded','voided')) AS unresolved,
                  count(*) FILTER (WHERE COALESCE((c.card_json->>'bookmarked')::boolean,false)) AS bookmarked,
                  count(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1 FROM notebook_entry_categories ec
                    WHERE ec.entry_id=c.id AND ec.owner_user_id=c.owner_user_id
                  )) AS uncategorized
                FROM assessment_cards c LEFT JOIN sessions s
                  ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE c.owner_user_id=:owner AND s.deleted_at IS NULL
            """), {"owner": owner_user_id})).mappings().one()
        return {key: int(row[key]) for key in (
            "total", "wrong", "unresolved", "bookmarked", "uncategorized"
        )}

    async def materials(self, owner_user_id: str) -> list[dict[str, Any]]:
        async with self._sessions() as db:
            rows = (await db.execute(text("""
                SELECT c.card_json->>'source' AS source,
                  c.card_json->>'material_id' AS material_id,
                  COALESCE(NULLIF(max(c.card_json->>'material_title'),''),
                    c.card_json->>'material_id') AS material_title,
                  count(*) AS entry_count,
                  count(*) FILTER (WHERE
                    COALESCE((c.card_json->>'is_correct')::boolean,false)=false
                    AND COALESCE((c.card_json->>'resolved')::boolean,false)=false
                    AND COALESCE(c.card_json->>'result','') NOT IN ('ungraded','voided'))
                    AS unresolved_count
                FROM assessment_cards c LEFT JOIN sessions s
                  ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                WHERE c.owner_user_id=:owner AND s.deleted_at IS NULL
                  AND COALESCE(c.card_json->>'material_id','')<>''
                GROUP BY c.card_json->>'source',c.card_json->>'material_id'
                ORDER BY material_title
            """), {"owner": owner_user_id})).mappings().all()
        return [dict(row) for row in rows]

    @staticmethod
    def _entry(row: Any) -> dict[str, Any]:
        card = dict(row["card_json"] or {})
        return {
            **card,
            "id": int(row["id"]),
            "session_id": row["session_id"] or "",
            "session_title": row["session_title"] or "",
            "origin_type": row["origin_type"],
            "origin_ref": row["origin_ref"],
            "turn_id": row["turn_id"],
            "question_id": row["question_id"],
            "created_at": row["created_at"].timestamp(),
            "updated_at": row["updated_at"].timestamp(),
            "categories": row.get("categories_json") or [],
            "practice": row.get("practice_json"),
        }

    async def upsert_entries(
        self, owner_user_id: str, session_id: str | None, items: list[dict[str, Any]]
    ) -> int:
        count = 0
        async with self._sessions() as db:
            for item in items:
                navigation, kind, ref = _origin(session_id, item)
                if navigation:
                    owns = (
                        await db.execute(
                            text("""SELECT 1 FROM sessions
                                    WHERE id=:session AND owner_user_id=:owner"""),
                            {"session": navigation, "owner": owner_user_id},
                        )
                    ).scalar_one_or_none()
                    if owns is None:
                        raise ValueError(f"Session not found: {navigation}")
                question = str(item.get("question") or "").strip()
                question_id = str(item.get("question_id") or "").strip()
                if not question or not question_id:
                    continue
                turn_id = str(item.get("turn_id") or "").strip()
                key = f"{owner_user_id}:{kind}:{ref}:{turn_id}:{question_id}"
                await db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                    {"key": key},
                )
                prior = (
                    await db.execute(
                        text("""SELECT id,card_json FROM assessment_cards
                                WHERE owner_user_id=:owner AND origin_type=:kind
                                  AND origin_ref=:ref AND turn_id=:turn
                                  AND question_id=:question FOR UPDATE"""),
                        {
                            "owner": owner_user_id, "kind": kind, "ref": ref,
                            "turn": turn_id, "question": question_id,
                        },
                    )
                ).mappings().first()
                old = dict(prior["card_json"] or {}) if prior else {}
                correct = bool(item.get("is_correct"))
                previous = old.get("is_correct") if prior else None
                trend = (
                    "new" if previous is None else
                    "unchanged" if bool(previous) == correct else
                    "improved" if correct else "declined"
                )
                source = str(item.get("source") or "deep_question")
                if source not in ASSESSMENT_SOURCES:
                    source = "deep_question"
                assessment_type = str(item.get("assessment_type") or "").strip()
                if assessment_type not in ASSESSMENT_TYPES:
                    assessment_type = ""
                result = str(item.get("result") or "").strip()
                if result not in ASSESSMENT_RESULTS:
                    result = "correct" if correct else "incorrect"
                if prior is None:
                    resolved = result == "voided" or (result != "ungraded" and correct)
                elif result == "ungraded":
                    resolved = bool(old.get("resolved"))
                elif result == "voided" or correct:
                    resolved = True
                elif bool(old.get("is_correct")):
                    resolved = False
                else:
                    resolved = bool(old.get("resolved"))
                now = time.time()
                card = {
                    **old,
                    **item,
                    "question": question,
                    "question_id": question_id,
                    "origin_type": kind,
                    "origin_ref": ref,
                    "turn_id": turn_id,
                    "source": source,
                    "assessment_type": assessment_type,
                    "result": result,
                    "is_correct": correct,
                    "resolved": resolved,
                    "score_trend": trend,
                    "bookmarked": bool(old.get("bookmarked", False)),
                    "followup_session_id": str(old.get("followup_session_id") or ""),
                    "created_at": old.get("created_at") or now,
                    "updated_at": now,
                }
                if not isinstance(item.get("user_answer_images"), list) and prior is not None:
                    card["user_answer_images"] = old.get("user_answer_images") or []
                for field, default, minimum in (
                    ("attempt_count", 1, 1), ("hints_used", 0, 0),
                ):
                    try:
                        card[field] = max(minimum, int(item.get(field, default) or default))
                    except (TypeError, ValueError):
                        card[field] = default
                card["options"] = card.get("options") or {}
                card["user_answer_images"] = card.get("user_answer_images") or []
                card.setdefault("ai_judgment", old.get("ai_judgment", ""))
                card_id = (await db.execute(
                    text("""INSERT INTO assessment_cards
                            (owner_user_id,session_id,origin_type,origin_ref,turn_id,
                             question_id,card_json,created_at,updated_at)
                            VALUES (:owner,:session,:kind,:ref,:turn,:question,
                                    CAST(:card AS JSONB),:created,:updated)
                            ON CONFLICT (owner_user_id,origin_type,origin_ref,turn_id,question_id)
                            DO UPDATE SET session_id=EXCLUDED.session_id,
                              card_json=EXCLUDED.card_json,updated_at=EXCLUDED.updated_at
                            RETURNING id"""),
                    {
                        "owner": owner_user_id, "session": navigation,
                        "kind": kind, "ref": ref, "turn": turn_id,
                        "question": question_id,
                        "card": json.dumps(card, ensure_ascii=False, allow_nan=False),
                        "created": datetime.fromtimestamp(card["created_at"], timezone.utc),
                        "updated": datetime.fromtimestamp(now, timezone.utc),
                    },
                )).scalar_one()
                if prior is not None and any(
                    old.get(field) != card.get(field)
                    for field in ("question", "options", "correct_answer")
                ):
                    await db.execute(text("""
                        UPDATE notebook_practice_state SET version=version+1
                        WHERE owner_user_id=:owner AND entry_id=:entry
                    """), {"owner": owner_user_id, "entry": card_id})
                if not correct and result != "ungraded":
                    first_wrong = previous is True or old.get("result") == "ungraded"
                    await db.execute(text("""
                        INSERT INTO notebook_practice_state
                          (owner_user_id,entry_id,is_mistake,first_wrong_at,due_at)
                        VALUES (:owner,:entry,true,:now,:due)
                        ON CONFLICT (owner_user_id,entry_id) DO UPDATE SET
                          is_mistake=true,
                          first_wrong_at=CASE WHEN :reset AND NOT notebook_practice_state.is_mistake
                            THEN :now ELSE notebook_practice_state.first_wrong_at END,
                          due_at=CASE WHEN :reset THEN :due ELSE notebook_practice_state.due_at END,
                          interval_days=CASE WHEN :reset THEN 1 ELSE notebook_practice_state.interval_days END,
                          streak=CASE WHEN :reset THEN 0 ELSE notebook_practice_state.streak END,
                          version=CASE WHEN :reset THEN notebook_practice_state.version+1
                            ELSE notebook_practice_state.version END
                    """), {"owner": owner_user_id, "entry": card_id,
                           "now": datetime.fromtimestamp(now, timezone.utc),
                           "due": datetime.fromtimestamp(now + 86400, timezone.utc),
                           "reset": first_wrong})
                count += 1
            await db.commit()
        return count

    async def get_entry(self, owner_user_id: str, entry_id: int) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(f"""SELECT c.*,COALESCE(s.title,'') AS session_title,
                            {self._categories_sql}, {self._practice_sql}
                            FROM assessment_cards c LEFT JOIN sessions s
                              ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                            WHERE c.owner_user_id=:owner AND c.id=:id"""),
                    {"owner": owner_user_id, "id": int(entry_id)},
                )
            ).mappings().first()
        return self._entry(row) if row else None

    async def find_by_origin(
        self, owner_user_id: str, origin_type: str, origin_ref: str,
        question_id: str, turn_id: str | None = None,
    ) -> dict[str, Any] | None:
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text(f"""SELECT c.*,COALESCE(s.title,'') AS session_title,
                            {self._categories_sql}, {self._practice_sql}
                            FROM assessment_cards c LEFT JOIN sessions s
                              ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id
                            WHERE c.owner_user_id=:owner AND c.origin_type=:kind
                              AND c.origin_ref=:ref AND c.turn_id=:turn
                              AND c.question_id=:question"""),
                    {
                        "owner": owner_user_id, "kind": origin_type,
                        "ref": origin_ref, "turn": turn_id or "",
                        "question": question_id,
                    },
                )
            ).mappings().first()
        return self._entry(row) if row else None

    async def update_entry(
        self, owner_user_id: str, entry_id: int, updates: dict[str, Any]
    ) -> bool:
        allowed = {
            "bookmarked", "followup_session_id", "user_answer",
            "is_correct", "ai_judgment", "resolved",
        }
        fields = {key: value for key, value in updates.items() if key in allowed}
        if not fields:
            return False
        async with self._sessions() as db:
            row = (
                await db.execute(
                    text("""SELECT card_json FROM assessment_cards
                            WHERE id=:id AND owner_user_id=:owner FOR UPDATE"""),
                    {"id": int(entry_id), "owner": owner_user_id},
                )
            ).mappings().first()
            if row is None:
                return False
            card = {**(row["card_json"] or {}), **fields, "updated_at": time.time()}
            await db.execute(
                text("""UPDATE assessment_cards
                        SET card_json=CAST(:card AS JSONB),updated_at=now()
                        WHERE id=:id AND owner_user_id=:owner"""),
                {
                    "card": json.dumps(card, ensure_ascii=False, allow_nan=False),
                    "id": int(entry_id), "owner": owner_user_id,
                },
            )
            await db.commit()
            return True

    async def delete_entry(self, owner_user_id: str, entry_id: int) -> bool:
        async with self._sessions() as db:
            deleted = (
                await db.execute(
                    text("""DELETE FROM assessment_cards
                            WHERE id=:id AND owner_user_id=:owner RETURNING id"""),
                    {"id": int(entry_id), "owner": owner_user_id},
                )
            ).scalar_one_or_none()
            await db.commit()
        return deleted is not None

    async def list_entries(
        self, owner_user_id: str, *,
        category_id: int | None = None,
        mistakes_only: bool = False,
        uncategorized: bool = False,
        bookmarked: bool | None = None,
        is_correct: bool | None = None,
        source: str = "",
        material_id: str = "",
        section_id: str = "",
        assessment_type: str = "",
        result: str = "",
        mastery_path_id: str = "",
        knowledge_point_id: str = "",
        resolved: bool | None = None,
        score_trend: str = "",
        search: str = "",
        session_id: str | None = None,
        session_ids: list[str] | None = None,
        sort: str = "recent",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        clauses = ["c.owner_user_id=:owner", "s.deleted_at IS NULL"]
        params: dict[str, Any] = {"owner": owner_user_id}
        if category_id is not None:
            clauses.append("""EXISTS (SELECT 1 FROM notebook_entry_categories ec
                WHERE ec.entry_id=c.id AND ec.owner_user_id=c.owner_user_id
                  AND ec.category_id=:category_id)""")
            params["category_id"] = category_id
        elif uncategorized:
            clauses.append("""NOT EXISTS (SELECT 1 FROM notebook_entry_categories ec
                WHERE ec.entry_id=c.id AND ec.owner_user_id=c.owner_user_id)""")
        if mistakes_only:
            clauses.append("""EXISTS (SELECT 1 FROM notebook_practice_state r
                WHERE r.entry_id=c.id AND r.owner_user_id=c.owner_user_id
                  AND r.is_mistake)""")
        for field, value in (
            ("source", source), ("material_id", material_id),
            ("section_id", section_id), ("assessment_type", assessment_type),
            ("mastery_path_id", mastery_path_id),
            ("knowledge_point_id", knowledge_point_id),
            ("score_trend", score_trend),
        ):
            if value:
                clauses.append(f"c.card_json->>'{field}'=:{field}")
                params[field] = value
        for field, value in (
            ("bookmarked", bookmarked), ("is_correct", is_correct),
            ("resolved", resolved),
        ):
            if value is not None:
                clauses.append(f"COALESCE((c.card_json->>'{field}')::boolean,false)=:{field}")
                params[field] = bool(value)
        if is_correct is False:
            clauses.append("COALESCE(c.card_json->>'result','') NOT IN ('ungraded','voided')")
        if result:
            if result in {"correct", "incorrect"}:
                clauses.append(
                    "(c.card_json->>'result'=:result OR "
                    "(COALESCE(c.card_json->>'result','')='' AND "
                    "COALESCE((c.card_json->>'is_correct')::boolean,false)=:result_correct))"
                )
                params["result_correct"] = result == "correct"
            else:
                clauses.append("c.card_json->>'result'=:result")
            params["result"] = result
        if session_id is not None:
            clauses.append("c.session_id=:session_id")
            params["session_id"] = session_id
        if session_ids is not None:
            if not session_ids:
                return {"items": [], "total": 0}
            clauses.append("c.session_id=ANY(:session_ids)")
            params["session_ids"] = list(session_ids)
        if search:
            needle = search.replace("\\", "\\\\").replace("%", "\\%")
            needle = needle.replace("_", "\\_")
            params["needle"] = f"%{needle}%"
            clauses.append(
                "(c.card_json->>'question' ILIKE :needle ESCAPE '\\' OR "
                "c.card_json->>'user_answer' ILIKE :needle ESCAPE '\\' OR "
                "c.card_json->>'correct_answer' ILIKE :needle ESCAPE '\\' OR "
                "c.card_json->>'explanation' ILIKE :needle ESCAPE '\\')"
            )
        where = " AND ".join(clauses)
        order = "ASC" if sort == "oldest" else "DESC"
        params["limit"] = max(1, min(int(limit), 200))
        params["offset"] = max(0, int(offset))
        base = (
            "FROM assessment_cards c LEFT JOIN sessions s "
            "ON s.id=c.session_id AND s.owner_user_id=c.owner_user_id "
            f"WHERE {where}"
        )
        async with self._sessions() as db:
            total = (
                await db.execute(text(f"SELECT count(*) {base}"), params)
            ).scalar_one()
            rows = (
                await db.execute(
                    text(
                        f"SELECT c.*,COALESCE(s.title,'') AS session_title, "
                        f"{self._categories_sql}, {self._practice_sql} {base} "
                        f"ORDER BY c.created_at {order},c.id {order} "
                        "LIMIT :limit OFFSET :offset"
                    ),
                    params,
                )
            ).mappings().all()
        return {"items": [self._entry(row) for row in rows], "total": int(total)}
