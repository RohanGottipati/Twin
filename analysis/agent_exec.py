"""
Agent Python runner: short read-only analysis for Backboard tools.

Stdin JSON: {code, twin?, overlays?, seed?}
Stdout JSON: {ok, stdout, stderr, result_preview, error}

Preloads: pandas, numpy, scipy, statsmodels, sklearn, pymongo (read-only db).
"""

from __future__ import annotations

import io
import json
import os
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

SEED = 2262


def _readonly_collection(coll: Any) -> Any:
    blocked = (
        "insert_one",
        "insert_many",
        "update_one",
        "update_many",
        "replace_one",
        "delete_one",
        "delete_many",
        "find_one_and_update",
        "find_one_and_replace",
        "find_one_and_delete",
        "bulk_write",
        "drop",
        "create_index",
        "create_indexes",
        "drop_index",
        "drop_indexes",
        "rename",
    )

    class ReadOnlyColl:
        def __init__(self, inner: Any):
            self._inner = inner

        def __getattr__(self, name: str) -> Any:
            if name in blocked:
                raise PermissionError(f"Mongo write/admin blocked: {name}")
            return getattr(self._inner, name)

        def aggregate(self, *args: Any, **kwargs: Any) -> Any:
            # aggregations are read-only if pipeline has no $out/$merge
            pipeline = args[0] if args else kwargs.get("pipeline", [])
            for stage in pipeline:
                if not isinstance(stage, dict):
                    continue
                keys = set(stage.keys())
                if keys & {"$out", "$merge"}:
                    raise PermissionError("Mongo aggregate $out/$merge blocked (read-only).")
            return self._inner.aggregate(*args, **kwargs)

    return ReadOnlyColl(coll)


def _readonly_db(db: Any) -> Any:
    class ReadOnlyDb:
        def __init__(self, inner: Any):
            self._inner = inner
            self.name = inner.name

        def __getitem__(self, name: str) -> Any:
            return _readonly_collection(self._inner[name])

        def __getattr__(self, name: str) -> Any:
            if name.startswith("_"):
                raise AttributeError(name)
            # db.collection_name style
            return _readonly_collection(getattr(self._inner, name))

        def list_collection_names(self, *args: Any, **kwargs: Any) -> Any:
            return self._inner.list_collection_names(*args, **kwargs)

        def command(self, *args: Any, **kwargs: Any) -> Any:
            raise PermissionError("Mongo db.command blocked (read-only).")

    return ReadOnlyDb(db)


def _preview(obj: Any, max_rows: int = 20) -> Any:
    try:
        import pandas as pd

        if isinstance(obj, pd.DataFrame):
            return {
                "type": "dataframe",
                "columns": [str(c) for c in obj.columns.tolist()],
                "shape": list(obj.shape),
                "rows": json.loads(obj.head(max_rows).to_json(orient="records", date_format="iso")),
            }
        if isinstance(obj, pd.Series):
            return {
                "type": "series",
                "name": str(obj.name),
                "shape": [int(obj.shape[0])],
                "rows": json.loads(obj.head(max_rows).to_json(date_format="iso")),
            }
    except Exception:
        pass
    if isinstance(obj, (dict, list, str, int, float, bool)) or obj is None:
        return {"type": "json", "value": obj}
    return {"type": "repr", "value": repr(obj)[:4000]}


def main() -> None:
    payload = json.load(sys.stdin)
    code = payload["code"]
    seed = int(payload.get("seed", SEED))

    # scientific stack: always available in agent namespace
    import numpy as np
    import pandas as pd
    from scipy import stats as scipy_stats

    try:
        import statsmodels.api as sm
    except Exception:  # optional until uv sync
        sm = None
    try:
        from sklearn import preprocessing as sk_preprocessing
        from sklearn import linear_model as sk_linear_model
    except Exception:
        sk_preprocessing = None
        sk_linear_model = None

    np.random.seed(seed)

    uri = (
        os.environ.get("MONGODB_URI_READONLY", "").strip()
        or os.environ.get("MONGODB_URI", "").strip()
    )
    db_name = os.environ.get("MONGODB_DATABASE", "techto").strip() or "techto"
    mongo_client = None
    db = None
    if uri:
        from pymongo import MongoClient

        mongo_client = MongoClient(uri, serverSelectionTimeoutMS=8000)
        db = _readonly_db(mongo_client[db_name])

    twin = payload.get("twin")
    overlays = payload.get("overlays") or []
    data_dir = os.path.join(os.path.dirname(__file__), "..", "data", "processed")
    data_dir = os.path.abspath(data_dir)

    ns: dict[str, Any] = {
        "np": np,
        "numpy": np,
        "pd": pd,
        "pandas": pd,
        "scipy_stats": scipy_stats,
        "stats": scipy_stats,
        "sm": sm,
        "statsmodels": sm,
        "sk_preprocessing": sk_preprocessing,
        "sk_linear_model": sk_linear_model,
        "db": db,
        "mongo": mongo_client,
        "TWIN": twin,
        "OVERLAYS": overlays,
        "DATA_DIR": data_dir,
        "SEED": seed,
        "RESULT": None,
        "json": json,
        "os": os,
    }

    out_buf = io.StringIO()
    err_buf = io.StringIO()
    error = None
    try:
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            exec(compile(code, "<agent_python>", "exec"), ns, ns)  # noqa: S102
    except Exception:
        error = traceback.format_exc()

    preview = None
    if ns.get("RESULT") is not None and error is None:
        preview = _preview(ns["RESULT"])

    if mongo_client is not None:
        mongo_client.close()

    result = {
        "ok": error is None,
        "stdout": out_buf.getvalue()[-50_000:],
        "stderr": err_buf.getvalue()[-20_000:],
        "result_preview": preview,
        "error": error,
        "mongo_bound": db is not None,
        "libs": {
            "numpy": True,
            "pandas": True,
            "scipy": True,
            "statsmodels": sm is not None,
            "sklearn": sk_preprocessing is not None,
            "pymongo": True,
        },
    }
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    if error is not None:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
