"""Parallel-first GRPO reward: patch Flash/TRL at import time.

Flash rl.py scores completions in a serial for-loop. We wrap GRPOTrainer so
reward_fn(batch) fans out across a thread pool from the first step.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import wraps

# match step size (16x8=128); keep many HTTP judges in flight
DEFAULT_WORKERS = int(os.environ.get("TECHTO_REWARD_WORKERS", "32"))

_reward_pool: ThreadPoolExecutor | None = None


def _reward_pool_get(max_workers: int) -> ThreadPoolExecutor:
    global _reward_pool
    if _reward_pool is None:
        _reward_pool = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="grpo-rew",
        )
    return _reward_pool


def _wrap_reward_fn(reward_fn, *, max_workers: int = DEFAULT_WORKERS):
    @wraps(reward_fn)
    def parallel_reward_fn(completions, **kwargs):
        if kwargs.get("reward") is not None:
            return reward_fn(completions, **kwargs)
        n = len(completions)
        if n <= 1:
            return reward_fn(completions, **kwargs)

        example_idx = kwargs.get("example_idx")
        if example_idx is None or len(example_idx) != n:
            return reward_fn(completions, **kwargs)

        workers = min(max_workers, n)
        out = [0.0] * n
        pool = _reward_pool_get(max_workers)

        def _one(i: int) -> tuple[int, float]:
            kw = dict(kwargs)
            kw["example_idx"] = [example_idx[i]]
            kw.pop("reward", None)
            vals = reward_fn([completions[i]], **kw)
            return i, float(vals[0])

        futs = [pool.submit(_one, i) for i in range(n)]
        for fut in as_completed(futs):
            i, r = fut.result()
            out[i] = r
        print(f"[torontwin] parallel reward_fn n={n} workers={workers}", flush=True)
        return out

    return parallel_reward_fn


def _patch_reward_funcs_arg(args, kwargs, max_workers: int):
    """Mutate args/kwargs so reward_funcs is wrapped. Returns (args, kwargs)."""
    args = list(args)
    if "reward_funcs" in kwargs:
        rfs = kwargs["reward_funcs"]
        if callable(rfs):
            kwargs["reward_funcs"] = _wrap_reward_fn(rfs, max_workers=max_workers)
        elif isinstance(rfs, (list, tuple)):
            kwargs["reward_funcs"] = [
                _wrap_reward_fn(f, max_workers=max_workers) if callable(f) else f for f in rfs
            ]
        return tuple(args), kwargs

    # positional: GRPOTrainer(model, reward_funcs, ...) is uncommon; scan callables
    # Flash uses kw-only reward_funcs=...
    return tuple(args), kwargs


def install_parallel_grpo_reward(*, max_workers: int = DEFAULT_WORKERS) -> None:
    """Install ASAP: wrap GRPOTrainer.__init__ (idempotent)."""
    try:
        from trl import GRPOTrainer
    except Exception as e:
        print(f"[torontwin] parallel reward: GRPOTrainer not ready yet ({e})", flush=True)
        # retry later from load_environment
        return

    if getattr(GRPOTrainer, "_torontwin_parallel_reward", False):
        return

    _orig_init = GRPOTrainer.__init__

    @wraps(_orig_init)
    def _init(self, *args, **kwargs):
        args, kwargs = _patch_reward_funcs_arg(args, kwargs, max_workers)
        return _orig_init(self, *args, **kwargs)

    GRPOTrainer.__init__ = _init  # type: ignore[method-assign]
    GRPOTrainer._torontwin_parallel_reward = True
    print(
        f"[torontwin] parallel-first GRPO reward ON (workers={max_workers})",
        flush=True,
    )


# install on import: before Flash builds the trainer
install_parallel_grpo_reward()
