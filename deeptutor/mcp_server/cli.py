from __future__ import annotations

import asyncio

import typer

app = typer.Typer(
    name="mcp", help="Serve DeepTutor over Model Context Protocol.", no_args_is_help=True
)


@app.command("serve")
def serve(
    transport: str = typer.Option(
        "stdio", "--transport", help="Transport: stdio (T1); http arrives in T3."
    ),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8001, "--port"),
) -> None:
    """Start the external MCP server."""
    from .factory import build_runtime_services
    from .server import create_mcp_server

    if transport != "stdio":
        raise typer.BadParameter("T1 supports only --transport stdio; HTTP arrives in T3.")
    jobs, store = build_runtime_services()
    server = create_mcp_server(
        owner_user_id="local-dev-user",
        job_service=jobs,
        object_store=store,
    )
    asyncio.run(server.run_stdio_async())


def main() -> None:  # pragma: no cover
    app(prog_name="deeptutor mcp")


if __name__ == "__main__":  # pragma: no cover
    main()
