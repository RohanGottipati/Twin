# FreeSolo CitizenReactionLM training scaffold

This folder is the TechTO training entrypoint for FreeSolo (SFT → optional OPD → GRPO).

## Layout

- `schemas.py` — reaction JSON contract
- `reward.py` — GRPO reward sketch (schema, feasibility, aggregate fit)
- `environment.py` — Flash/FreeSolo env stub
- `configs/` — placeholder TOML

## Notes

- RL must train only on past-policy / held-out scenario splits (AGENTS.md 5.3).
- Never present trained outputs as real Toronto public opinion.
- Demo path today uses `TECHTO_CITIZEN_REACTION_PROVIDER=mock` or `freesolo` with API fallback.
