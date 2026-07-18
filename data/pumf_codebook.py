"""Parse the StatCan 2021 Census Individuals PUMF SPSS syntax file into a
value-label lookup table: {variable_name: {code: label}}.

Source: `StatCan/doi-10/Command Code/ipumf_2021_final_en.sps` (shipped by
StatCan alongside the PUMF as read syntax for SPSS; despite the file's own
`/* ENCODING CP1252 */` comment it is actually UTF-8 -- confirmed by decoding
accented labels like "Métis" correctly only under utf-8).
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CODEBOOK_PATH = REPO_ROOT / "StatCan" / "doi-10" / "Command Code" / "ipumf_2021_final_en.sps"

_VAR_BLOCK_RE = re.compile(r"\n\s*/(\w+)\n")
_CODE_LINE_RE = re.compile(r'^\s*(-?\d+)\s+"([^"]*)"\s*$', re.MULTILINE)


def load_value_labels(path: Path = CODEBOOK_PATH) -> dict[str, dict[int, str]]:
    text = path.read_text(encoding="utf-8")
    start = text.index("VALUE LABELS")
    end_markers = ["\nEXECUTE", "\nSAVE", "\nVARIABLE LABELS"]
    end = len(text)
    for marker in end_markers:
        pos = text.find(marker, start)
        if pos != -1:
            end = min(end, pos)
    body = text[start:end]

    parts = _VAR_BLOCK_RE.split(body)
    # parts[0] is the "VALUE LABELS" preamble; then alternating (varname, block).
    result: dict[str, dict[int, str]] = {}
    for i in range(1, len(parts), 2):
        varname = parts[i]
        block = parts[i + 1]
        codes = {int(code): label for code, label in _CODE_LINE_RE.findall(block)}
        if codes:
            result[varname] = codes
    return result


if __name__ == "__main__":
    labels = load_value_labels()
    print(f"{len(labels)} variables with value labels")
    for var in ("AGEGRP", "Gender", "TENUR", "MODE", "IMMSTAT", "GENSTAT", "VISMIN", "HDGREE", "CMA"):
        print(var, "->", labels.get(var))
