from __future__ import annotations

import asyncio
import os

import typer

app = typer.Typer(
    name="mcp", help="Serve DeepTutor over Model Context Protocol.", no_args_is_help=True
)


def _runner(deterministic: bool):
    if deterministic:
        return None
    from .mcp_runner import TurnCapabilityRunner

    return TurnCapabilityRunner()


@app.command("serve")
def serve(
    transport: str = typer.Option("stdio", "--transport", help="Transport: stdio or http."),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8001, "--port"),
) -> None:
    """Start the external MCP server (stdio or streamable HTTP)."""
    deterministic = os.environ.get("DEEPTUTOR_MCP_DETERMINISTIC", "").lower() in {
        "1",
        "true",
        "yes",
    }
    if transport == "stdio":
        from deeptutor.mcp_server.factory import build_runtime_services
        from deeptutor.mcp_server.server import create_mcp_server

        jobs, store = build_runtime_services(runner=_runner(deterministic))
        extras = {}
        if os.environ.get("DATABASE_URL"):
            # Same application services as the cloud stack; stdio just uses the
            # single local account instead of per-request Bearer principals.
            from deeptutor.learning.storage_postgres import PostgresMasteryRepository
            from deeptutor.services.hooks import HookService
            from deeptutor.services.postgres.database import create_engine
            from deeptutor.services.practice.postgres import PostgresPracticeRepository
            from deeptutor.services.reading.service import ReadingService

            reading_answerer = None
            if not deterministic or os.environ.get("DEEPTUTOR_READING_LLM") == "1":
                from deeptutor.services.reading.llm_answerer import LLMReadingAnswerer

                reading_answerer = LLMReadingAnswerer()

            engine = create_engine(os.environ["DATABASE_URL"])
            extras = {
                "practice_repo": PostgresPracticeRepository(engine),
                "mastery_repo": PostgresMasteryRepository(engine),
                "reading_service": ReadingService(
                    engine, object_store=store, answerer=reading_answerer
                ),
                "hook_service": HookService(engine),
            }
        server = create_mcp_server(
            owner_user_id="local-dev-user",
            job_service=jobs,
            object_store=store,
            **extras,
        )
        asyncio.run(server.run_stdio_async())
        return

    if transport == "http":
        import uvicorn

        from deeptutor.mcp_server.cloud import build_cloud_app
        from deeptutor.mcp_server.factory import _build_object_store

        http_app = build_cloud_app(
            object_store=_build_object_store(),
            runner=_runner(deterministic),
        )
        uvicorn.run(http_app, host=host, port=port, log_level=os.environ.get("LOG_LEVEL", "info"))
        return

    raise typer.BadParameter("transport must be 'stdio' or 'http'")


def main() -> None:  # pragma: no cover
    app(prog_name="deeptutor mcp")


if __name__ == "__main__":  # pragma: no cover
    main()
