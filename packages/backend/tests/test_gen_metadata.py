"""Unit tests for pure generation-metadata extraction: A1111 string parsing,
ComfyUI graph walking, signature stability across id renumbering, tokenisation,
and grouping."""

from src.services import gen_metadata as gm


# --- A1111 -------------------------------------------------------------------

A1111_FULL = (
    "a cyberpunk city, neon, masterpiece\n"
    "Negative prompt: blurry, lowres\n"
    "Steps: 30, Sampler: Euler a, CFG scale: 7.5, Seed: 12345, "
    "Size: 512x768, Model: realisticVision_v5"
)


def test_a1111_parses_all_fields():
    g = gm.parse_a1111(A1111_FULL)
    assert g["source"] == "a1111"
    assert g["prompt"] == "a cyberpunk city, neon, masterpiece"
    assert g["negative"] == "blurry, lowres"
    assert g["seed"] == 12345
    assert g["steps"] == 30
    assert g["cfg"] == 7.5
    assert g["sampler"] == "Euler a"
    assert g["model"] == "realisticVision_v5"


def test_a1111_without_negative():
    g = gm.parse_a1111("just a prompt\nSteps: 20, Seed: 1")
    assert g["prompt"] == "just a prompt"
    assert g["negative"] is None
    assert g["seed"] == 1


def test_a1111_empty_is_safe():
    g = gm.parse_a1111("")
    assert g["source"] == "a1111"
    assert g["prompt"] is None and g["seed"] is None


# --- ComfyUI -----------------------------------------------------------------

COMFY = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 999,
            "steps": 25,
            "cfg": 8.0,
            "sampler_name": "dpmpp_2m",
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    },
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a fox in snow"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly, blurry"}},
    "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024}},
}


def test_comfyui_structural_extraction():
    g = gm.parse_comfyui(COMFY)
    assert g["source"] == "comfyui"
    assert g["prompt"] == "a fox in snow"
    assert g["negative"] == "ugly, blurry"
    assert g["seed"] == 999
    assert g["steps"] == 25
    assert g["cfg"] == 8.0
    assert g["sampler"] == "dpmpp_2m"
    assert g["model"] == "sdxl.safetensors"


def test_comfyui_positive_negative_disambiguated_by_edge_not_order():
    # Even though node 7 (negative) could be picked first by class, the edge from
    # the sampler's `positive` link must select node 6.
    g = gm.parse_comfyui(COMFY)
    assert g["prompt"] == "a fox in snow"


def test_comfyui_model_via_lora_passthrough():
    graph = dict(COMFY)
    graph["3"] = {**COMFY["3"], "inputs": {**COMFY["3"]["inputs"], "model": ["8", 0]}}
    graph["8"] = {
        "class_type": "LoraLoader",
        "inputs": {"lora_name": "x.safetensors", "model": ["4", 0]},
    }
    g = gm.parse_comfyui(graph)
    assert g["model"] == "sdxl.safetensors"


# --- Signature ---------------------------------------------------------------


def test_signature_stable_across_id_renumber():
    renumbered = {
        ("4" + k if False else str(int(k) + 40)): v for k, v in COMFY.items()
    }
    assert gm.workflow_sig(COMFY) == gm.workflow_sig(renumbered)


def test_signature_stable_across_value_tweak():
    tweaked = dict(COMFY)
    tweaked["6"] = {"class_type": "CLIPTextEncode", "inputs": {"text": "totally different"}}
    assert gm.workflow_sig(COMFY) == gm.workflow_sig(tweaked)


def test_signature_changes_on_node_kind_change():
    extra = dict(COMFY)
    extra["99"] = {"class_type": "UpscaleModelLoader", "inputs": {}}
    assert gm.workflow_sig(COMFY) != gm.workflow_sig(extra)


def test_signature_none_on_empty():
    assert gm.workflow_sig({}) is None
    assert gm.workflow_sig(None) is None


# --- Tokenise / group --------------------------------------------------------


def test_tokenize_splits_commas_and_whitespace_lowercase_dedup():
    terms = gm.tokenize_prompt("Cyberpunk City, neon, NEON")
    assert terms == ["city", "cyberpunk", "neon"]


def test_tokenize_preserves_lora_and_danbooru_tokens():
    terms = gm.tokenize_prompt("1girl, <lora:foo:0.8>")
    assert "1girl" in terms
    assert "<lora:foo:0.8>" in terms


def test_group_id_same_for_same_sig_and_prompt():
    a = gm.group_id("sigX", "same prompt")
    b = gm.group_id("sigX", "same prompt")
    assert a == b and a is not None


def test_group_id_none_without_prompt():
    assert gm.group_id("sigX", "") is None
    assert gm.group_id("sigX", None) is None


def test_group_id_differs_by_prompt():
    assert gm.group_id("sigX", "p1") != gm.group_id("sigX", "p2")


# --- Dispatcher --------------------------------------------------------------


def test_extract_comfyui_fills_derived_fields():
    g = gm.extract({"source": "comfyui", "prompt": COMFY})
    assert g["model"] == "sdxl.safetensors"
    assert g["workflow_sig"] is not None
    assert "fox" in g["prompt_terms"]
    assert g["group_id"] is not None


def test_extract_a1111():
    g = gm.extract({"source": "a1111", "parameters": A1111_FULL})
    assert g["seed"] == 12345
    assert "cyberpunk" in g["prompt_terms"]


def test_extract_unknown_source_returns_none():
    assert gm.extract({"source": "nope"}) is None
    assert gm.extract(None) is None
