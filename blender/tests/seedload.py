"""Tiny frontmatter loader for the seed files (supports the restricted YAML used there: scalars,
inline flow lists/maps, block lists of flow maps, one-level nested block maps). No PyYAML needed."""
import json
import re


def _flow(text):
    t = text.strip()
    if t[:1] in "[{":
        # quote bare words (keys and string values)
        def q(m):
            w = m.group(0)
            return w if w in ("true", "false", "null") else '"%s"' % w
        j = re.sub(r'"[^"]*"|(?<![\w."-])-?\d+(?:\.\d+)?(?![\w."])|[A-Za-z_][\w.\-]*', lambda m: m.group(0) if m.group(0).startswith('"') or re.match(r'-?\d', m.group(0)) else q(m), t)
        return json.loads(j)
    return _scalar(t)


def _scalar(t):
    t = t.strip()
    if t in ("null", "~", ""):
        return None
    if t in ("true", "false"):
        return t == "true"
    if t[:1] == '"' and t[-1:] == '"':
        return json.loads(t)
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t)
    except ValueError:
        return t


def parse_frontmatter(text):
    text = text.replace("\r\n", "\n")
    assert text.startswith("---\n"), "no frontmatter"
    end = text.index("\n---", 4)
    block, body = text[4:end], text[end + 4:].lstrip("\n")
    data, key, cur = {}, None, None
    for raw in block.split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0:
            k, _, v = line.partition(":")
            k, v = k.strip(), v.strip()
            if v == "":
                data[k] = None
                key, cur = k, None
            else:
                if " #" in v and v[:1] not in "\"[{":
                    v = v.split(" #")[0]
                data[k] = _flow(v)
                key = None
        else:
            if line.startswith("- "):
                if data[key] is None:
                    data[key] = []
                data[key].append(_flow(line[2:]))
            else:
                if data[key] is None:
                    data[key] = {}
                k, _, v = line.partition(":")
                data[key][k.strip()] = _flow(v)
    return data, body


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return parse_frontmatter(f.read())
