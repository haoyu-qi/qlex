"""Read local Antigravity desktop and CLI conversation databases."""
import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import url2pathname


def sqlite_signature(path):
    main = path.stat()
    try:
        wal = path.with_name(path.name + '-wal').stat()
    except FileNotFoundError:
        return (main.st_size, main.st_mtime_ns), None
    return (main.st_size, main.st_mtime_ns), (wal.st_size, wal.st_mtime_ns)


@contextmanager
def read_db(path):
    uri = path.resolve().as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True)) as db:
        try:
            db.execute('PRAGMA schema_version').fetchone()
        except sqlite3.OperationalError:
            # An idle WAL-mode database can lack the sidecars needed by a
            # read-only connection. Only use the main file when no WAL exists.
            before = sqlite_signature(path)
            if before[1] is not None:
                raise
            with closing(sqlite3.connect(uri + '&immutable=1', uri=True)) as idle:
                yield idle
                if sqlite_signature(path) != before:
                    raise ValueError('antigravity_database_changed_during_read')
        else:
            yield db


def workspaces(conversations):
    index = conversations.parent / 'conversation_summaries.db'
    result = {}
    with read_db(index) as db:
        for session, value in db.execute(
            'SELECT conversation_id, workspace_uris FROM conversation_summaries'
        ):
            uris = json.loads(value) if value else []
            # WorkContext records have one owning project. Unbound and
            # multi-root conversations cannot be assigned to one workspace.
            if not isinstance(uris, list) or len(uris) != 1 or not isinstance(uris[0], str):
                continue
            uri = urlsplit(uris[0])
            if uri.scheme == 'file' and uri.netloc in ('', 'localhost') and not (uri.query or uri.fragment):
                directory = url2pathname(uri.path)
                if Path(directory).is_absolute() and '\0' not in directory:
                    result[session] = directory
    return result


def varint(raw, offset):
    value = 0
    for shift in range(0, 70, 7):
        if offset >= len(raw):
            break
        byte = raw[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
    raise ValueError('invalid_antigravity_protobuf')


def fields(raw, wanted):
    values = {}
    offset = 0
    while offset < len(raw):
        tag, offset = varint(raw, offset)
        number, wire = divmod(tag, 8)
        if not number or wire not in (0, 1, 2, 5):
            raise ValueError('invalid_antigravity_protobuf')
        if wire == 0:
            value, offset = varint(raw, offset)
        else:
            if wire == 2:
                size, offset = varint(raw, offset)
            else:
                size = 8 if wire == 1 else 4
            end = offset + size
            if end > len(raw):
                raise ValueError('invalid_antigravity_protobuf')
            value = raw[offset:end] if number in wanted else None
            offset = end
        if number in wanted:
            values[number] = value
    return values


def messages(path, skip_oversized=False):
    with read_db(path) as db:
        # Only completed UserInput (14) and PlannerResponse (15) steps.
        # The selected payload fields contain the visible message. Sibling
        # fields contain reasoning, tool calls, attachments and prompts.
        for index, kind, metadata, payload, encoding in db.execute(
            'SELECT idx, step_type, metadata, step_payload, step_format FROM steps '
            'WHERE step_type IN (14, 15) AND status=3 ORDER BY idx'
        ):
            if encoding != 0:
                raise ValueError('unsupported_antigravity_step_format')
            ordinal = index + 1
            timestamp = fields(fields(metadata or b'', {1}).get(1, b''), {1, 2})
            row = {'session_id': path.stem, 'role': 'user' if kind == 14 else 'assistant'}
            if 1 in timestamp:
                row['timestamp'] = timestamp[1] + timestamp.get(2, 0) / 1_000_000_000
            if len(payload) > 1048576:
                if not skip_oversized:
                    raise ValueError('record_exceeds_limit')
                row['content'] = 'Source record content omitted: record exceeds 1 MiB limit.'
            else:
                field, message = (19, 2) if kind == 14 else (20, 3)
                outer = fields(payload, {1, field})
                if outer.get(1) != kind:
                    raise ValueError('unsupported_antigravity_step_payload')
                row['content'] = fields(outer.get(field, b''), {message}).get(message, b'').decode('utf-8')
            yield ordinal, row
