"""Student GRPO prompt: free-text opinion (AGENTS.md 5.2)."""


def build_student_prompt(inp: dict) -> str:
    persona = inp.get("persona_text") or ""
    policy = inp.get("policy_text") or ""
    parts = []
    if persona:
        parts.append(f"PERSONA:\n{persona}")
    if policy:
        parts.append(f"QUESTION:\n{policy}")
    parts.append(
        "Write your opinion on this question in first person, in your own voice. "
        "Be concrete. Do not pick a letter A/B/C/D; write prose only."
    )
    return "\n\n".join(parts)


def build_judge_prompt(opinion: str, question: str, options: dict) -> str:
    # options like {"A": "...", "B": "..."}
    opt_lines = "\n".join(f"{k}. {v}" for k, v in sorted(options.items()))
    return (
        "You map a person's written opinion onto a multiple-choice survey item.\n"
        "Pick exactly one of A, B, C, D, or none.\n"
        "Use none if the opinion does not clearly entail any option.\n"
        "Reply with ONLY the single token: A, B, C, D, or none.\n\n"
        f"QUESTION:\n{question}\n\n"
        f"OPTIONS:\n{opt_lines}\n\n"
        f"OPINION:\n{opinion}\n"
    )
