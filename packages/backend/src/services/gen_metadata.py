"""Generation-metadata extraction: pure parsers turning embedded AI-art data
(Automatic1111 parameter strings, ComfyUI node graphs) into the structured
``gen.*`` fields the gallery searches and displays.

Everything here is pure (no I/O), so it is unit-testable without a database or
image files. The scanner reads the *raw* embedded data off disk and stores it
verbatim; :func:`extract` (re)derives structured fields from that stored raw,
which is why reprojection never needs to touch disk again.

Two source formats, two strategies:

- **a1111** — the ``parameters`` text blob: positive prompt, an optional
  ``Negative prompt:`` block, then a trailing ``key: value, ...`` settings line.
- **comfyui** — the ``prompt`` (API-format) JSON: a ``{node_id: {class_type,
  inputs}}`` graph. There is no flat "prompt" field, so we walk from the sampler
  node's ``positive``/``negative`` input links back to their source text nodes
  (the structural fallback). IDs are never trusted — they renumber on edit.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


# --- Resilient JSON parsing (pure) -------------------------------------------
#
# Embedded ComfyUI metadata is hand-assembled by a zoo of custom nodes and is
# routinely not strictly valid JSON. The two malformations seen in the wild are
# recoverable and worth recovering, since a dropped `prompt` chunk loses the
# whole signature + extraction for every image of that workflow:
#
#   - literal control characters inside string values (a real newline pasted
#     into a text-encode widget) — ``strict=False`` accepts them;
#   - trailing bytes after the JSON document (NUL padding, a second
#     concatenated blob) — ``raw_decode`` stops at the document's close.
#
# Truncated JSON (a clipped chunk) stays unrecoverable and returns ``None``.

_LENIENT = json.JSONDecoder(strict=False)


def loads_lenient(text: Any) -> Any | None:
    """Parse embedded metadata JSON, tolerating control chars + trailing bytes.

    Tries strict parsing first (the common case), then a lenient
    control-char-tolerant decode that ignores anything after the first complete
    value. Returns ``None`` when no leading JSON value can be salvaged — callers
    treat that the same as an absent chunk.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    try:
        obj, _ = _LENIENT.raw_decode(text.lstrip())
        return obj
    except (ValueError, TypeError):
        return None


def raw_matches_term(raw: Any, term: str) -> bool:
    """Does the lowercased ``term`` appear anywhere in a raw embedded-metadata doc?

    Searches the whole stored raw (ComfyUI ``prompt``/``workflow`` graphs or the
    A1111 ``parameters`` string) by stringifying it. This is the search source the
    rules page needs: a custom workflow whose prompt the structural parser can't
    reach has ``gen.prompt = None`` and empty ``prompt_terms``, so the only place
    a remembered keyword like ``masterpiece`` survives is the raw text itself.
    """
    if not term:
        return False
    try:
        blob = json.dumps(raw, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return False
    return term.lower() in blob.lower()


# Canonical empty structured result. Callers fill what they can; nulls mean the
# heuristic couldn't find it (which is fine — raw is always retained).
_EMPTY: dict[str, Any] = {
    "source": None,
    "workflow_sig": None,
    "prompt": None,
    "negative": None,
    "seed": None,
    "model": None,
    "sampler": None,
    "steps": None,
    "cfg": None,
    "prompt_terms": [],
    "group_id": None,
}


def _empty(**over: Any) -> dict[str, Any]:
    g = dict(_EMPTY)
    g["prompt_terms"] = []
    g.update(over)
    return g


def _to_int(v: Any) -> int | None:
    try:
        if v is None or isinstance(v, bool):
            return None
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def _to_float(v: Any) -> float | None:
    try:
        if v is None or isinstance(v, bool):
            return None
        return float(str(v).strip())
    except (ValueError, TypeError):
        return None


# --- Tokenisation & grouping (pure) ------------------------------------------


def tokenize_prompt(*texts: str | None) -> list[str]:
    """Split prompt text into lowercased search terms.

    Splits on commas and whitespace so danbooru tags (``1girl``) and lora tokens
    (``<lora:foo:0.8>``, which contain no internal spaces) survive intact.
    Returns a sorted, de-duplicated list for stable storage + ``$in`` matching.
    """
    terms: set[str] = set()
    for text in texts:
        if not text:
            continue
        for part in re.split(r"[,\s]+", text.lower()):
            p = part.strip()
            if p:
                terms.add(p)
    return sorted(terms)


def group_id(sig: str | None, positive: str | None) -> str | None:
    """Stable id for a batch of variations: images sharing a workflow signature
    AND identical positive prompt. ``None`` when there is no positive prompt, so
    prompt-less images never collapse into one giant pile."""
    pos = (positive or "").strip()
    if not pos:
        return None
    basis = f"{sig or ''}\x00{pos}"
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


# --- ComfyUI ------------------------------------------------------------------


def workflow_sig(prompt_json: dict[str, Any] | None) -> str | None:
    """Hash the sorted multiset of node ``class_type``s.

    Ignores node ids, widget values and edges, so it is stable across id
    renumbering and value tweaks; it changes only when node *kinds* are
    added/removed. Coarse by design.
    """
    if not isinstance(prompt_json, dict) or not prompt_json:
        return None
    types = sorted(
        str(n.get("class_type", ""))
        for n in prompt_json.values()
        if isinstance(n, dict)
    )
    if not any(types):
        return None
    return hashlib.sha1("\x00".join(types).encode("utf-8")).hexdigest()[:16]


def _node(prompt_json: dict[str, Any], ref: Any) -> dict[str, Any] | None:
    """Resolve a ComfyUI input link ``[node_id, slot]`` to its node dict."""
    if not isinstance(ref, list) or not ref:
        return None
    node = prompt_json.get(str(ref[0]))
    return node if isinstance(node, dict) else None


def _resolve_text(
    prompt_json: dict[str, Any], ref: Any, _seen: set[str] | None = None
) -> str | None:
    """Follow a link to a text-encode node and return its ``text`` widget.

    Recurses through pass-through nodes (e.g. a primitive feeding ``text``),
    guarding against cycles.
    """
    node = _node(prompt_json, ref)
    if node is None:
        return None
    seen = _seen or set()
    key = str(ref[0])
    if key in seen:
        return None
    seen.add(key)

    text = node.get("inputs", {}).get("text")
    if isinstance(text, str):
        return text
    if isinstance(text, list):  # text itself is a link
        return _resolve_text(prompt_json, text, seen)
    return None


def _resolve_ckpt(
    prompt_json: dict[str, Any], ref: Any, _seen: set[str] | None = None
) -> str | None:
    """Walk the ``model`` link upstream to a checkpoint loader's name widget."""
    node = _node(prompt_json, ref)
    if node is None:
        return None
    seen = _seen or set()
    key = str(ref[0])
    if key in seen:
        return None
    seen.add(key)

    inputs = node.get("inputs", {})
    for name_key in ("ckpt_name", "base_ckpt_name", "model_name", "unet_name"):
        v = inputs.get(name_key)
        if isinstance(v, str) and v:
            return v
    # Keep walking upstream through model-patch nodes (LoRA loaders etc.).
    return _resolve_ckpt(prompt_json, inputs.get("model"), seen)


def _find_sampler(prompt_json: dict[str, Any]) -> dict[str, Any] | None:
    for node in prompt_json.values():
        if not isinstance(node, dict):
            continue
        ct = str(node.get("class_type", ""))
        if "Sampler" in ct or "sampler" in ct.lower():
            inp = node.get("inputs", {})
            # Prefer a node that actually carries conditioning links.
            if "positive" in inp or "latent_image" in inp or "seed" in inp:
                return node
    return None


def parse_comfyui(prompt_json: dict[str, Any] | None) -> dict[str, Any]:
    """Best-effort structural extraction from a ComfyUI ``prompt`` graph."""
    g = _empty(source="comfyui")
    if not isinstance(prompt_json, dict) or not prompt_json:
        return g

    sampler = _find_sampler(prompt_json)
    if sampler is not None:
        inp = sampler.get("inputs", {})
        g["seed"] = _to_int(inp.get("seed", inp.get("noise_seed")))
        g["steps"] = _to_int(inp.get("steps"))
        g["cfg"] = _to_float(inp.get("cfg"))
        sn = inp.get("sampler_name")
        if isinstance(sn, str):
            g["sampler"] = sn
        g["prompt"] = _resolve_text(prompt_json, inp.get("positive"))
        g["negative"] = _resolve_text(prompt_json, inp.get("negative"))
        g["model"] = _resolve_ckpt(prompt_json, inp.get("model"))

    # Class fallback for the checkpoint when the sampler walk missed it.
    if not g["model"]:
        for node in prompt_json.values():
            if isinstance(node, dict) and "Checkpoint" in str(
                node.get("class_type", "")
            ):
                ck = node.get("inputs", {}).get("ckpt_name")
                if isinstance(ck, str) and ck:
                    g["model"] = ck
                    break
    return g


# --- Automatic1111 ------------------------------------------------------------

_NEG_MARKER = "Negative prompt:"
_PARAM_RE = re.compile(r"([A-Za-z][A-Za-z0-9 ]*?):\s*([^,\n]+)")


def parse_a1111(text: str | None) -> dict[str, Any]:
    """Parse the A1111 ``parameters`` blob into structured fields."""
    g = _empty(source="a1111")
    if not text or not text.strip():
        return g
    s = text.strip()

    # The settings live on the line containing "Steps:"; everything before that
    # line is the prompt section (positive + optional negative).
    idx = s.rfind("Steps:")
    if idx != -1:
        line_start = s.rfind("\n", 0, idx) + 1
        params = s[line_start:]
        head = s[:line_start].strip()
    else:
        params, head = "", s

    if _NEG_MARKER in head:
        pos, _, neg = head.partition(_NEG_MARKER)
        g["prompt"] = pos.strip() or None
        g["negative"] = neg.strip() or None
    else:
        g["prompt"] = head.strip() or None

    for key, val in _PARAM_RE.findall(params):
        k = key.strip().lower()
        v = val.strip()
        if k == "seed":
            g["seed"] = _to_int(v)
        elif k == "model":
            g["model"] = v or None
        elif k == "sampler":
            g["sampler"] = v or None
        elif k == "steps":
            g["steps"] = _to_int(v)
        elif k == "cfg scale":
            g["cfg"] = _to_float(v)
    return g


# --- User extraction rules (pure) --------------------------------------------
#
# A ruleset (one per workflow_sig) pins dot-paths into the raw doc for specific
# fields. Pins are tried first; a resolving pin overrides the structural/class
# baseline. The fallback chain is therefore pinned -> structural -> class, and
# structural is never removed — only overridden when a pin actually resolves.

# Fields a user may pin, and their coercion. Derived fields (workflow_sig,
# prompt_terms, group_id, source) are computed, never pinned.
_INT_FIELDS = frozenset({"seed", "steps"})
_FLOAT_FIELDS = frozenset({"cfg"})
_RULE_FIELDS = frozenset({"prompt", "negative", "seed", "model", "sampler", "steps", "cfg"})


def resolve_path(raw: Any, path: str) -> Any:
    """Walk a dot-path into the raw doc (``prompt.32.inputs.text0``).

    Segments index dict keys or, when the current value is a list, integer
    positions. Returns ``None`` on any miss (missing key, bad index, walking
    through a scalar) — never raises.
    """
    if not path or not isinstance(raw, (dict, list)):
        return None
    cur: Any = raw
    for seg in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(seg)
        elif isinstance(cur, list):
            try:
                cur = cur[int(seg)]
            except (ValueError, IndexError):
                return None
        else:
            return None
        if cur is None:
            return None
    return cur


def _coerce_field(field: str, value: Any) -> Any:
    """Coerce a pin's resolved value to the field's type, matching the structural
    parser's coercion. A non-scalar resolution (link/dict/list) is a miss."""
    if value is None:
        return None
    if field in _INT_FIELDS:
        return _to_int(value)
    if field in _FLOAT_FIELDS:
        return _to_float(value)
    # String fields accept only strings; a link (list) or node (dict) is a miss
    # so the structural fallback handles it instead of storing garbage.
    if isinstance(value, str):
        return value or None
    return None


def resolve_ruleset_paths(
    raw: dict[str, Any], fields: dict[str, list[str]]
) -> dict[str, list[dict[str, Any]]]:
    """Per-path resolution for the authoring preview: for each field, each pinned
    path with its raw resolved value and coerced result. Lets the UI show whether
    a specific pin fired, distinct from the final field value."""
    out: dict[str, list[dict[str, Any]]] = {}
    for field, paths in (fields or {}).items():
        if field not in _RULE_FIELDS:
            continue
        rows: list[dict[str, Any]] = []
        for path in paths or []:
            resolved = resolve_path(raw, path)
            rows.append(
                {
                    "path": path,
                    "raw": resolved if isinstance(resolved, (str, int, float, bool)) else None,
                    "coerced": _coerce_field(field, resolved),
                }
            )
        out[field] = rows
    return out


def clean_rule_fields(fields: Any) -> dict[str, list[str]]:
    """Validate/normalise a ruleset's ``fields`` for storage: keep only known
    fields, coerce each to a list of non-empty path strings, drop empties."""
    out: dict[str, list[str]] = {}
    if not isinstance(fields, dict):
        return out
    for field in _RULE_FIELDS:
        raw_paths = fields.get(field)
        if not isinstance(raw_paths, list):
            continue
        paths = [p.strip() for p in raw_paths if isinstance(p, str) and p.strip()]
        if paths:
            out[field] = paths
    return out


def _apply_ruleset(g: dict[str, Any], raw: dict[str, Any], ruleset: dict[str, Any]) -> None:
    """Override structural baseline ``g`` with the first resolving pin per field."""
    fields = ruleset.get("fields") or {}
    for field, paths in fields.items():
        if field not in _RULE_FIELDS:
            continue
        for path in paths or []:
            coerced = _coerce_field(field, resolve_path(raw, path))
            if coerced is not None:
                g[field] = coerced
                break


# --- Top-level dispatcher -----------------------------------------------------


def extract(
    raw: dict[str, Any] | None, ruleset: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Derive structured ``gen.*`` from a stored raw doc.

    ``raw`` is the ``image_gen_raw`` document shape:
        ``{"source": "comfyui", "prompt": {...}, "workflow": {...}}`` or
        ``{"source": "a1111", "parameters": "<text>"}``.

    ``ruleset`` (optional) pins dot-paths per field; a resolving pin overrides the
    structural/class baseline. Returns ``None`` for an unrecognised/empty source.
    ``workflow_sig``, ``prompt_terms`` and ``group_id`` are always derived here
    (the single place), never by the scanner.
    """
    if not isinstance(raw, dict):
        return None
    source = raw.get("source")

    if source == "comfyui":
        prompt_json = raw.get("prompt") if isinstance(raw.get("prompt"), dict) else {}
        g = parse_comfyui(prompt_json)
        g["workflow_sig"] = workflow_sig(prompt_json)
    elif source == "a1111":
        g = parse_a1111(raw.get("parameters"))
    else:
        return None

    if ruleset:
        _apply_ruleset(g, raw, ruleset)

    g["prompt_terms"] = tokenize_prompt(g.get("prompt"), g.get("negative"))
    g["group_id"] = group_id(g.get("workflow_sig"), g.get("prompt"))
    return g
