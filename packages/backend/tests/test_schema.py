"""The sync and async clients must agree on indexes — that's the whole point of
collapsing the two duplicated definitions into one schema module."""

from src.database import schema


def _names(models):
    return sorted(m.document["name"] for m in models)


def test_image_indexes_have_expected_names():
    assert _names(schema.image_indexes()) == sorted(
        [
            "lib_id__id",
            "tags__id",
            "lib_id_has_tags__id",
            "lib_id_tags__id",
            "lib_id_has_ai_tags__id",
            "gen_prompt_terms__id",
            "gen_model__id",
            "gen_workflow_sig",
            "gen_group_id",
        ]
    )


def test_gen_raw_indexes_have_expected_names():
    assert _names(schema.gen_raw_indexes()) == sorted(
        ["gen_raw_library_id", "gen_raw_lib_sig", "gen_raw_sig"]
    )


def test_client_kwargs_are_shared_and_sane():
    kw = schema.client_kwargs()
    assert kw["appname"] == "tagify"
    assert kw["retryReads"] is True
    assert kw["retryWrites"] is True
    assert kw["maxPoolSize"] >= 1
