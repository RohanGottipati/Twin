import pytest

from twin.state import TwinState


@pytest.fixture(scope="session")
def base_state() -> TwinState:
    """Version 0 of the twin, loaded once per test session from the real
    ingested data/processed/ slice (Ward 13, Toronto Centre)."""
    return TwinState.load_from_processed()
