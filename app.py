#!/usr/bin/env python3
"""Layout-only HTMX rendering of the Recursive Benchmark Lab."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent
TABS = ("benchmarks", "results", "failures", "data", "environments", "settings")
TAB_LABELS = {
    "benchmarks": ("01", "Benchmarks", "done", 1),
    "results": ("02", "Results", "done", 1),
    "failures": ("03", "Failure map", "done", 1),
    "data": ("04", "Data forge", "done", 1),
    "environments": ("05", "Env lab", "active", 0),
}

app = FastAPI(title="recursive( ) htmx layout")
app.mount("/assets", StaticFiles(directory=ROOT / "static"), name="assets")
templates = Jinja2Templates(directory=str(ROOT / "templates"))


def context(request: Request, tab: str) -> dict:
    if tab not in TABS:
        tab = "benchmarks"
    return {
        "request": request,
        "tab": tab,
        "tabs": TABS,
        "tab_labels": TAB_LABELS,
        "hx": request.headers.get("HX-Request") == "true",
    }


@app.get("/", response_class=HTMLResponse)
@app.get("/{tab}", response_class=HTMLResponse)
def page(request: Request, tab: str = "benchmarks") -> HTMLResponse:
    ctx = context(request, tab)
    template = "workspace.html" if ctx["hx"] else "layout.html"
    return templates.TemplateResponse(template, ctx)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8766, reload=True)
