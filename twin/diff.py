"""Diff two twin versions (AGENTS.md 4.2 `diff(a, b)`).

A diff is computed purely from two `TwinState` snapshots -- it does not
assume `b` was produced from `a` by `patch()` (though in practice it usually
is), so it works for comparing any two versions, e.g. rolling back and
diffing against an older one.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from twin.schema import LayerName
from twin.state import TwinState


class LayerDiff(BaseModel):
    added: list[str] = []
    removed: list[str] = []
    modified: dict[str, dict[str, tuple[Any, Any]]] = {}

    @property
    def is_empty(self) -> bool:
        return not (self.added or self.removed or self.modified)


class PolicyDiff(BaseModel):
    added: list[str] = []
    removed: list[str] = []
    modified: dict[str, dict[str, tuple[Any, Any]]] = {}

    @property
    def is_empty(self) -> bool:
        return not (self.added or self.removed or self.modified)


class Diff(BaseModel):
    from_version: int
    to_version: int
    layers: dict[str, LayerDiff]
    policies: PolicyDiff

    @property
    def is_empty(self) -> bool:
        return all(d.is_empty for d in self.layers.values()) and self.policies.is_empty

    def summary(self) -> str:
        lines = [f"diff v{self.from_version} -> v{self.to_version}"]
        for layer, d in self.layers.items():
            if d.is_empty:
                continue
            lines.append(f"  {layer}: +{len(d.added)} -{len(d.removed)} ~{len(d.modified)}")
        if not self.policies.is_empty:
            lines.append(
                f"  policies: +{len(self.policies.added)} -{len(self.policies.removed)} "
                f"~{len(self.policies.modified)}"
            )
        if self.is_empty:
            lines.append("  (no changes)")
        return "\n".join(lines)


def _field_diff(old_dict: dict[str, Any], new_dict: dict[str, Any]) -> dict[str, tuple[Any, Any]]:
    changed: dict[str, tuple[Any, Any]] = {}
    keys = set(old_dict) | set(new_dict)
    for key in keys:
        old_val, new_val = old_dict.get(key), new_dict.get(key)
        if old_val != new_val:
            changed[key] = (old_val, new_val)
    return changed


def diff(a: TwinState, b: TwinState) -> Diff:
    layer_names: set[LayerName] = set(a.layers.keys()) | set(b.layers.keys())  # type: ignore[arg-type]
    layer_diffs: dict[str, LayerDiff] = {}
    for layer in layer_names:
        old_features = a.layers.get(layer, {})
        new_features = b.layers.get(layer, {})
        old_ids, new_ids = set(old_features), set(new_features)
        added = sorted(new_ids - old_ids)
        removed = sorted(old_ids - new_ids)
        modified: dict[str, dict[str, tuple[Any, Any]]] = {}
        for feature_id in sorted(old_ids & new_ids):
            old_dump = old_features[feature_id].model_dump()
            new_dump = new_features[feature_id].model_dump()
            changed = _field_diff(old_dump, new_dump)
            if changed:
                modified[feature_id] = changed
        layer_diffs[layer] = LayerDiff(added=added, removed=removed, modified=modified)

    old_policy_ids, new_policy_ids = set(a.policies), set(b.policies)
    policy_added = sorted(new_policy_ids - old_policy_ids)
    policy_removed = sorted(old_policy_ids - new_policy_ids)
    policy_modified: dict[str, dict[str, tuple[Any, Any]]] = {}
    for policy_id in sorted(old_policy_ids & new_policy_ids):
        changed = _field_diff(a.policies[policy_id].model_dump(), b.policies[policy_id].model_dump())
        if changed:
            policy_modified[policy_id] = changed
    policy_diff = PolicyDiff(added=policy_added, removed=policy_removed, modified=policy_modified)

    return Diff(from_version=a.version, to_version=b.version, layers=layer_diffs, policies=policy_diff)
