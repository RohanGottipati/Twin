from model.scorer.placeholder import score_opinion


def test_positive_opinion_scores_above_neutral():
    text = "I love this change, it's a great improvement and very convenient for my commute."
    assert score_opinion(text) > 0.5


def test_negative_opinion_scores_below_neutral():
    text = "I oppose this, it's an unfair and costly burden that will hurt local traffic."
    assert score_opinion(text) < 0.5


def test_neutral_or_empty_text_scores_at_midpoint():
    assert score_opinion("") == 0.5
    assert score_opinion("The stop is located at the corner.") == 0.5


def test_score_is_bounded():
    very_positive = "great " * 50
    very_negative = "bad " * 50
    assert 0.0 <= score_opinion(very_positive) <= 1.0
    assert 0.0 <= score_opinion(very_negative) <= 1.0
