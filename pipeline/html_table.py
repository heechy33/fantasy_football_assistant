"""Stdlib-only HTML <table> reader shared by the FFToday and CBS projection parsers.

Deliberately no requests/network imports live here — parse-first modules
(fftoday.py, and later cbs_projections.py) both pull from this so table reading
is testable against fixtures without touching the network. CBS must not import
fftoday (that would drag requests into a parse-first module), which is exactly
why this reader is extracted onto its own module.
"""

from __future__ import annotations

from html.parser import HTMLParser


class TableParser(HTMLParser):
    """Small table reader that ignores presentation markup and image alt text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "table" and self._table is None:
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in {"th", "td"} and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"th", "td"} and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            if self._row:
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)
