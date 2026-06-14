"""Unit tests for the pure tagger post-processing: MCUT and tag selection.
Previously buried inside WDTagger.predict behind an ONNX session."""

import numpy as np

from src.services.ai_tagger import LabelIndex, mcut_threshold, select_tags


def _labels() -> LabelIndex:
    # index: 0=rating safe, 1=rating explicit, 2=g:cat, 3=g:dog, 4=c:alice
    return LabelIndex(
        names=["safe", "explicit", "cat", "dog", "alice"],
        rating_idx=np.array([0, 1]),
        general_idx=np.array([2, 3]),
        character_idx=np.array([4]),
    )


def test_mcut_edge_cases():
    assert mcut_threshold(None) == 0.0
    assert mcut_threshold(np.array([])) == 0.0
    assert mcut_threshold(np.array([0.7])) == 0.7
    # biggest gap is between 0.9 and 0.2 -> midpoint 0.55
    assert mcut_threshold(np.array([0.9, 0.2, 0.1])) == 0.55


def test_select_tags_thresholds_and_sorts():
    preds = np.array([0.1, 0.8, 0.9, 0.3, 0.95])
    out = select_tags(_labels(), preds, general_thresh=0.35, character_thresh=0.85)
    # rating dict carries both rating labels with their probs
    assert out["rating"] == {"safe": 0.1, "explicit": 0.8}
    # only cat (0.9) passes the 0.35 general threshold; dog (0.3) drops
    assert out["general_tags"] == [("cat", 0.9)]
    # alice (0.95) passes the 0.85 character threshold
    assert out["character_tags"] == [("alice", 0.95)]
    assert out["caption"] == "cat"


def test_select_tags_max_general_caps_results():
    preds = np.array([0.0, 0.0, 0.9, 0.8, 0.0])
    out = select_tags(
        _labels(), preds, general_thresh=0.1, character_thresh=0.1, max_general=1
    )
    # both cat and dog pass, but cap=1 keeps only the top-scored (cat)
    assert out["general_tags"] == [("cat", 0.9)]


def test_select_tags_general_mcut_overrides_threshold():
    preds = np.array([0.0, 0.0, 0.9, 0.2, 0.0])
    out = select_tags(
        _labels(),
        preds,
        general_thresh=0.95,  # would drop everything...
        character_thresh=0.1,
        general_mcut=True,  # ...but mcut picks the gap midpoint (0.55)
    )
    assert out["general_tags"] == [("cat", 0.9)]
