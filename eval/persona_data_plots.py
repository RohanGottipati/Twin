"""Three simple plots demonstrating the city-wide persona data foundation,
for a quick judge/demo explanation. Reads the committed processed data only
(no LLM, no network). Run: uv run python -m eval.persona_data_plots
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
OUT_DIR = REPO_ROOT / "eval" / "output"

plt.rcParams["font.family"] = "IBM Plex Sans"


def plot_neighbourhood_coverage() -> Path:
    """158 neighbourhoods now covered, sized by real population -- shows the
    jump from the old 14-neighbourhood Ward-13 slice to city-wide."""
    census = pd.read_csv(PROCESSED_DIR / "census_profile.csv")
    census = census.sort_values("pop_total", ascending=False)

    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.bar(range(len(census)), census["pop_total"], color="#2b6cb0", width=1.0)
    ax.set_title(f"All {len(census)} Toronto neighbourhoods, by population (2021 Census)")
    ax.set_xlabel("Neighbourhood (ranked by population)")
    ax.set_ylabel("Population")
    ax.axvline(14, color="#e53e3e", linestyle="--", linewidth=1.5)
    ax.text(16, census["pop_total"].max() * 0.92, "old scope: 14", color="#e53e3e", fontsize=9)
    fig.tight_layout()
    out_path = OUT_DIR / "neighbourhood_coverage.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_income_by_age_joint() -> Path:
    """Real joint correlation from the StatCan PUMF (165k Toronto-CMA
    individuals): income actually varies by age, which independent-marginal
    sampling (age and income drawn separately) cannot reproduce."""
    pumf = pd.read_csv(PROCESSED_DIR / "pumf_toronto.csv")
    age_order = [
        "0 to 4 years", "5 to 6 years", "7 to 9 years", "10 to 11 years", "12 to 14 years",
        "15 to 17 years", "18 to 19 years", "20 to 24 years", "25 to 29 years", "30 to 34 years",
        "35 to 39 years", "40 to 44 years", "45 to 49 years", "50 to 54 years", "55 to 59 years",
        "60 to 64 years", "65 to 69 years", "70 to 74 years", "75 to 79 years", "80 to 84 years",
        "85 years and over",
    ]
    grouped = pumf.dropna(subset=["age_group", "total_income"]).groupby("age_group")["total_income"].median()
    grouped = grouped.reindex([a for a in age_order if a in grouped.index])

    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.plot(grouped.index, grouped.values, marker="o", color="#2f855a")
    ax.set_title("Median individual income by age (real Toronto CMA data, StatCan PUMF)")
    ax.set_ylabel("Median total income ($)")
    ax.set_xticks(range(len(grouped.index)))
    ax.set_xticklabels(grouped.index, rotation=60, ha="right", fontsize=8)
    fig.tight_layout()
    out_path = OUT_DIR / "income_by_age_joint.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_neighbourhood_diversity() -> Path:
    """Spread of visible-minority share across all 158 neighbourhoods --
    shows real demographic heterogeneity the personas need to reflect."""
    census = pd.read_csv(PROCESSED_DIR / "census_profile.csv")
    share = (census["vismin_total_visible_minority"] / census["vismin_total"] * 100).dropna()

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.hist(share, bins=20, color="#805ad5", edgecolor="white")
    ax.set_title("Visible-minority population share, across 158 neighbourhoods")
    ax.set_xlabel("% visible minority")
    ax.set_ylabel("Number of neighbourhoods")
    fig.tight_layout()
    out_path = OUT_DIR / "neighbourhood_diversity.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_income_by_tenure_violin() -> Path:
    """Violin plot: real income distribution split by tenure (PUMF). Owners
    and renters have genuinely different income shapes -- a joint pattern
    independent-marginal sampling can't reproduce."""
    pumf = pd.read_csv(PROCESSED_DIR / "pumf_toronto.csv")
    data = pumf.dropna(subset=["tenure", "total_income"])
    groups = [data.loc[data["tenure"] == t, "total_income"].clip(upper=250_000) for t in ["Owner", "Renter"]]

    fig, ax = plt.subplots(figsize=(6, 4.5))
    parts = ax.violinplot(groups, showmedians=True)
    for body in parts["bodies"]:
        body.set_facecolor("#2b6cb0")
        body.set_alpha(0.7)
    ax.set_xticks([1, 2])
    ax.set_xticklabels(["Owner", "Renter"])
    ax.set_ylabel("Individual total income ($, capped at $250k)")
    ax.set_title("Income distribution by tenure (real Toronto CMA data, PUMF)")
    fig.tight_layout()
    out_path = OUT_DIR / "income_by_tenure_violin.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_income_by_education_violin() -> Path:
    """Violin plot: real income distribution split by education level
    (PUMF), collapsed to a few readable buckets."""
    pumf = pd.read_csv(PROCESSED_DIR / "pumf_toronto.csv")
    bucket_map = {
        "No certificate, diploma or degree": "No certificate",
        "High (secondary) school diploma or equivalency certificate": "High school",
        "Non-apprenticeship trades certificate or diploma": "College/trades",
        " Apprenticeship certificate": "College/trades",
        "Program of 3 months to less than 1 year (College, CEGEP and other non-university certificates or diplomas)": "College/trades",
        "Program of 1 to 2 years (College, CEGEP and other non-university certificates or diplomas)": "College/trades",
        "Program of more than 2 years (College, CEGEP and other non-university certificates or diplomas)": "College/trades",
        "University certificate or diploma below bachelor level": "College/trades",
        "Bachelor's degree": "Bachelor's",
        "University certificate or diploma above bachelor level": "Bachelor's",
        "Degree in medicine, dentistry, veterinary medicine or optometry": "Graduate+",
        "Master's degree": "Graduate+",
        "Earned doctorate": "Graduate+",
    }
    order = ["No certificate", "High school", "College/trades", "Bachelor's", "Graduate+"]
    pumf["education_bucket"] = pumf["education"].map(bucket_map)
    data = pumf.dropna(subset=["education_bucket", "total_income"])
    groups = [data.loc[data["education_bucket"] == b, "total_income"].clip(upper=250_000) for b in order]

    fig, ax = plt.subplots(figsize=(8, 4.5))
    parts = ax.violinplot(groups, showmedians=True)
    for body in parts["bodies"]:
        body.set_facecolor("#2f855a")
        body.set_alpha(0.7)
    ax.set_xticks(range(1, len(order) + 1))
    ax.set_xticklabels(order, rotation=20, ha="right")
    ax.set_ylabel("Individual total income ($, capped at $250k)")
    ax.set_title("Income distribution by education (real Toronto CMA data, PUMF)")
    fig.tight_layout()
    out_path = OUT_DIR / "income_by_education_violin.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_neighbourhood_income_curve() -> Path:
    """Simple sorted curve: median household income across all 158
    neighbourhoods -- shows real city-wide inequality at a glance."""
    census = pd.read_csv(PROCESSED_DIR / "census_profile.csv")
    incomes = census["median_total_income"].dropna().sort_values().reset_index(drop=True)

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.plot(range(len(incomes)), incomes.values, color="#c05621", linewidth=2)
    ax.fill_between(range(len(incomes)), incomes.values, color="#c05621", alpha=0.15)
    ax.set_title("Median individual income, all 158 neighbourhoods (sorted)")
    ax.set_xlabel("Neighbourhood (ranked low to high)")
    ax.set_ylabel("Median total income ($)")
    fig.tight_layout()
    out_path = OUT_DIR / "neighbourhood_income_curve.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths = [
        plot_neighbourhood_coverage(),
        plot_income_by_age_joint(),
        plot_neighbourhood_diversity(),
        plot_income_by_tenure_violin(),
        plot_income_by_education_violin(),
        plot_neighbourhood_income_curve(),
    ]
    for p in paths:
        print(f"wrote {p}")


if __name__ == "__main__":
    main()
