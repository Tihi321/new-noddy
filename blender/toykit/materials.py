"""Procedural toy materials (all Eevee-friendly, object-space textures, no image files).

Kinds: wood (painted wood, glossy, chipped), felt, knit, clay, paint (glossy plain),
metal, glass, cardboard, ground_*, sky.  `surface(kind, hex)` picks one by PuppetSpec.material.
"""
import colorsys
import math

import bpy


# ----------------------------------------------------------------- colour helpers
def parse_hex(h):
    h = (h or "#888888").strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.5, 0.5, 0.5)


def _s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(h, a=1.0):
    r, g, b = parse_hex(h) if isinstance(h, str) else h
    return (_s2l(r), _s2l(g), _s2l(b), a)


def to_hex(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(c * 255)))) for c in rgb)


def shade(h, f):
    """Multiply brightness (f<1 darker, f>1 lighter, capped)."""
    r, g, b = parse_hex(h)
    return to_hex((min(r * f, 1), min(g * f, 1), min(b * f, 1)))


def mix_hex(a, b, t):
    ra, rb = parse_hex(a), parse_hex(b)
    return to_hex(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


def saturate(h, s=1.2, v=1.0):
    r, g, b = parse_hex(h)
    hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
    return to_hex(colorsys.hsv_to_rgb(hh, min(1, ss * s), min(1, vv * v)))


# ----------------------------------------------------------------- node helpers
_ALIASES = {
    'base': ['Base Color'], 'rough': ['Roughness'], 'metal': ['Metallic'],
    'specular': ['Specular IOR Level', 'Specular'],
    'sheen': ['Sheen Weight', 'Sheen'], 'sheen_rough': ['Sheen Roughness'], 'sheen_tint': ['Sheen Tint'],
    'coat': ['Coat Weight', 'Clearcoat'], 'coat_rough': ['Coat Roughness', 'Clearcoat Roughness'],
    'emission': ['Emission Color', 'Emission'], 'emission_strength': ['Emission Strength'],
    'subsurface': ['Subsurface Weight', 'Subsurface'], 'alpha': ['Alpha'], 'transmission': ['Transmission Weight', 'Transmission'],
    'ior': ['IOR'],
}


def sock(bsdf, key):
    for n in _ALIASES.get(key, [key]):
        if n in bsdf.inputs:
            return bsdf.inputs[n]
    return None


def setp(bsdf, **kw):
    for k, v in kw.items():
        s = sock(bsdf, k)
        if s is not None:
            s.default_value = v


def _mat(name):
    m = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        m.use_nodes = True  # always on (and deprecated) from Blender 5.0
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    return m, nt, b


def N(nt, kind, **attrs):
    n = nt.nodes.new(kind)
    for k, v in attrs.items():
        setattr(n, k, v)
    return n


def L(nt, a, b):
    nt.links.new(a, b)


def coords(nt):
    return N(nt, 'ShaderNodeTexCoord').outputs['Object']


def noise(nt, vec, scale=5.0, detail=3.0, rough=0.5, distortion=0.0):
    n = N(nt, 'ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    if 'Distortion' in n.inputs:
        n.inputs['Distortion'].default_value = distortion
    L(nt, vec, n.inputs['Vector'])
    return n


def ramp(nt, fac, stops):
    r = N(nt, 'ShaderNodeValToRGB')
    els = r.color_ramp.elements
    while len(els) > len(stops):
        els.remove(els[-1])
    while len(els) < len(stops):
        els.new(0.5)
    for e, (pos, col) in zip(els, stops):
        e.position = pos
        e.color = col if len(col) == 4 else (*col, 1.0)
    L(nt, fac, r.inputs['Fac'])
    return r


def mixc(nt, fac, a, b, blend='MIX'):
    """Colour mix. fac: socket or float. a/b: socket or rgba tuple."""
    m = N(nt, 'ShaderNodeMix', data_type='RGBA', blend_type=blend)
    if isinstance(fac, (int, float)):
        m.inputs[0].default_value = fac
    else:
        L(nt, fac, m.inputs[0])
    for idx, v in ((6, a), (7, b)):
        if isinstance(v, tuple) or isinstance(v, list):
            m.inputs[idx].default_value = v if len(v) == 4 else (*v, 1.0)
        else:
            L(nt, v, m.inputs[idx])
    return m.outputs[2]


def mathn(nt, op, a, b=None, clamp=False):
    m = N(nt, 'ShaderNodeMath', operation=op)
    m.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            L(nt, v, m.inputs[i])
    return m.outputs[0]


def bump(nt, height, strength=0.2, dist=0.01, normal=None):
    bn = N(nt, 'ShaderNodeBump')
    bn.inputs['Strength'].default_value = strength
    bn.inputs['Distance'].default_value = dist
    L(nt, height, bn.inputs['Height'])
    if normal is not None:
        L(nt, normal, bn.inputs['Normal'])
    return bn.outputs['Normal']


def _finish(m, nt, b, colour_out, hexc, normal=None):
    setp(b, base=lin(hexc))
    if colour_out is not None:
        L(nt, colour_out, sock(b, 'base'))
    if normal is not None:
        L(nt, normal, b.inputs['Normal'])
    return m


def _cached(name, build):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    return build(name)


# ----------------------------------------------------------------- toy surfaces
def wood(hexc, rough=0.30, wear=0.55):
    """Painted wood: glossy coat, subtle bump, random paint chips showing bare wood."""
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        base = lin(hexc)
        v1 = noise(nt, tc, 2.2, 3).outputs['Fac']
        col = mixc(nt, mathn(nt, 'MULTIPLY', v1, 0.35), base, lin(shade(hexc, 0.78)))
        chips = ramp(nt, noise(nt, tc, 16.0, 6, 0.6).outputs['Fac'], [(0.70, (0, 0, 0, 1)), (0.74, (1, 1, 1, 1))])
        chipmask = mathn(nt, 'MULTIPLY', mathn_sock(nt, chips), wear)
        col = mixc(nt, chipmask, col, lin('#d9b07a'))
        nrm = bump(nt, noise(nt, tc, 70.0, 4, 0.55).outputs['Fac'], 0.10, 0.004)
        setp(b, rough=rough, specular=0.5, coat=0.35, coat_rough=0.12)
        return _finish(m, nt, b, col, hexc, nrm)
    return _cached(f"wood_{hexc}", build)


def mathn_sock(nt, ramp_node):
    # red channel of ramp colour -> float
    sep = N(nt, 'ShaderNodeSeparateColor')
    L(nt, ramp_node.outputs['Color'], sep.inputs['Color'])
    return sep.outputs['Red']


def felt(hexc, fuzz=0.14, rough=0.95):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        lw = N(nt, 'ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.45
        lighter = lin(shade(mix_hex(hexc, '#ffffff', 0.35), 1.0))
        v1 = noise(nt, tc, 9.0, 3).outputs['Fac']
        col = mixc(nt, mathn(nt, 'MULTIPLY', v1, 0.25), lin(hexc), lin(shade(hexc, 0.84)))
        col = mixc(nt, fresnel_mask(nt, lw, fuzz), col, lighter)
        fib = noise(nt, tc, 140.0, 8, 0.7, 0.3).outputs['Fac']
        fib2 = noise(nt, tc, 40.0, 5, 0.6).outputs['Fac']
        h = mathn(nt, 'ADD', fib, mathn(nt, 'MULTIPLY', fib2, 0.5))
        nrm = bump(nt, h, 0.7, 0.006)
        setp(b, rough=rough, specular=0.15, sheen=0.9, sheen_rough=0.45)
        sh = sock(b, 'sheen_tint')
        if sh is not None and hasattr(sh, 'default_value') and len(sh.default_value) == 4:
            sh.default_value = lin(mix_hex(hexc, '#ffffff', 0.5))
        return _finish(m, nt, b, col, hexc, nrm)
    return _cached(f"felt_{hexc}", build)


def fresnel_mask(nt, lw, amount):
    # 'Facing' is 1 at grazing angles? (Layer Weight Facing: 0 facing viewer -> 1 at edges)
    return mathn(nt, 'MULTIPLY', lw.outputs['Facing'], amount * 2.2, clamp=True)


def knit(hexc, scale=75.0):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        mp = N(nt, 'ShaderNodeMapping')
        L(nt, tc, mp.inputs['Vector'])
        # rows (Z bands) x stitches (V-ish) = knit grid
        w1 = N(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', wave_profile='SAW')
        w1.inputs['Scale'].default_value = scale * 0.8
        w1.inputs['Distortion'].default_value = 1.5
        w1.inputs['Detail'].default_value = 1.0
        w1.inputs['Detail Scale'].default_value = 1.0
        L(nt, mp.outputs['Vector'], w1.inputs['Vector'])
        w2 = N(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', wave_profile='SIN')
        w2.inputs['Scale'].default_value = scale * 0.55
        w2.inputs['Distortion'].default_value = 2.0
        L(nt, mp.outputs['Vector'], w2.inputs['Vector'])
        h = mathn(nt, 'ADD', w1.outputs['Fac'], w2.outputs['Fac'])
        col = mixc(nt, mathn(nt, 'MULTIPLY', h, 0.3, clamp=True), lin(hexc), lin(shade(hexc, 0.72)))
        v1 = noise(nt, tc, 9.0, 3).outputs['Fac']
        col = mixc(nt, mathn(nt, 'MULTIPLY', v1, 0.18), col, lin(shade(hexc, 1.18)))
        nrm = bump(nt, h, 0.9, 0.012)
        setp(b, rough=0.95, specular=0.1, sheen=0.8, sheen_rough=0.5)
        return _finish(m, nt, b, col, hexc, nrm)
    return _cached(f"knit_{hexc}", build)


def clay(hexc, rough=0.5):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        col = mixc(nt, mathn(nt, 'MULTIPLY', noise(nt, tc, 3.0, 2).outputs['Fac'], 0.25), lin(hexc), lin(shade(hexc, 0.9)))
        nrm = bump(nt, noise(nt, tc, 22.0, 5, 0.6).outputs['Fac'], 0.12, 0.004)
        setp(b, rough=rough, specular=0.35, coat=0.1, subsurface=0.05)
        return _finish(m, nt, b, col, hexc, nrm)
    return _cached(f"clay_{hexc}", build)


def paint(hexc, rough=0.14, coat=0.6):
    """Plain glossy paint: eyes, cheeks (soft), buttons, lamp glass etc."""
    def build(name):
        m, nt, b = _mat(name)
        setp(b, rough=rough, specular=0.6, coat=coat, coat_rough=0.05)
        return _finish(m, nt, b, None, hexc)
    return _cached(f"paint_{hexc}_{rough}", build)


def soft(hexc, rough=0.7):
    def build(name):
        m, nt, b = _mat(name)
        setp(b, rough=rough, specular=0.3)
        return _finish(m, nt, b, None, hexc)
    return _cached(f"soft_{hexc}_{rough}", build)


def metal(hexc="#d8d8dc", rough=0.28):
    def build(name):
        m, nt, b = _mat(name)
        setp(b, rough=rough, metal=1.0)
        return _finish(m, nt, b, None, hexc)
    return _cached(f"metal_{hexc}", build)


def glass(hexc="#bfe3ff", glow=0.0):
    def build(name):
        m, nt, b = _mat(name)
        setp(b, rough=0.05, specular=0.8, coat=0.5, alpha=0.35)
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        if glow > 0:
            setp(b, emission=lin(hexc), emission_strength=glow)
        return _finish(m, nt, b, None, hexc)
    return _cached(f"glass_{hexc}_{glow}", build)


def glow(hexc, strength=4.0):
    def build(name):
        m, nt, b = _mat(name)
        setp(b, rough=0.3, emission=lin(hexc), emission_strength=strength)
        return _finish(m, nt, b, None, hexc)
    return _cached(f"glow_{hexc}_{strength}", build)


def rubber(hexc="#2b2b2e"):
    return soft(hexc, 0.6)


def water(hexc="#4fb4e8"):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        col = mixc(nt, mathn(nt, 'MULTIPLY', noise(nt, tc, 1.2, 2).outputs['Fac'], 0.5), lin(shade(hexc, 1.1)), lin(shade(hexc, 0.8)))
        w = N(nt, 'ShaderNodeTexWave', wave_type='RINGS', rings_direction='SPHERICAL')
        w.inputs['Scale'].default_value = 2.5
        w.inputs['Distortion'].default_value = 3.0
        L(nt, tc, w.inputs['Vector'])
        nrm = bump(nt, w.outputs['Fac'], 0.15, 0.03)
        setp(b, rough=0.06, specular=1.0, coat=0.8, coat_rough=0.02)
        return _finish(m, nt, b, col, hexc, nrm)
    return _cached(f"water_{hexc}", build)


def surface(kind, hexc):
    return {'wood': wood, 'felt': felt, 'knit': knit, 'clay': clay}.get(kind, wood)(hexc)


# ----------------------------------------------------------------- set materials
def cardboard(hexc, rough=0.9):
    """Painted cardboard cut-out (hills, flats)."""
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        col = mixc(nt, mathn(nt, 'MULTIPLY', noise(nt, tc, 4.0, 3).outputs['Fac'], 0.35), lin(hexc), lin(shade(hexc, 0.86)))
        nrm = bump(nt, noise(nt, tc, 90.0, 4, 0.5).outputs['Fac'], 0.15, 0.004)
        setp(b, rough=rough, specular=0.1, emission=lin(hexc), emission_strength=0.25)
        return _finish(m, nt, b, col, hexc, nrm)
    return _cached(f"card_{hexc}", build)


SKIES = {
    'sky_day': dict(top='#2f8fe0', horizon='#bfe4ff', cloud='#ffffff', emit=0.85, stars=False),
    'sky_sunset': dict(top='#6d6fd0', horizon='#ffb070', cloud='#ffd2c0', emit=0.8, stars=False),
    'sky_night': dict(top='#0b1646', horizon='#2c4f9a', cloud='#4a5f9e', emit=0.55, stars=True),
    'sky_snow': dict(top='#aebfd8', horizon='#f0f5fb', cloud='#ffffff', emit=0.9, stars=False),
}


def sky(kind, height=8.0):
    s = SKIES.get(kind, SKIES['sky_day'])

    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        sep = N(nt, 'ShaderNodeSeparateXYZ')
        L(nt, tc, sep.inputs['Vector'])
        z = mathn(nt, 'DIVIDE', sep.outputs['Z'], height, clamp=True)
        grad = ramp(nt, z, [(0.0, lin(s['horizon'])), (0.22, lin(s['horizon'])), (1.0, lin(s['top']))])
        col = grad.outputs['Color']
        # painted clouds: stretched noise thresholded to flat white blobs
        mp = N(nt, 'ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (0.35, 0.35, 0.8)
        mp.inputs['Location'].default_value = (3.0, 0.0, 0.0)
        L(nt, tc, mp.inputs['Vector'])
        cn = noise(nt, mp.outputs['Vector'], 1.3, 4, 0.5, 0.3).outputs['Fac']
        # fade clouds toward top and ground
        band = ramp(nt, z, [(0.18, (0, 0, 0, 1)), (0.3, (1, 1, 1, 1)), (0.75, (1, 1, 1, 1)), (0.95, (0, 0, 0, 1))])
        cmask = ramp(nt, cn, [(0.56, (0, 0, 0, 1)), (0.585, (1, 1, 1, 1))])
        cf = mathn(nt, 'MULTIPLY', mathn_sock(nt, cmask), mathn_sock(nt, band))
        col = mixc(nt, cf, col, lin(s['cloud']))
        if s['stars']:
            v = N(nt, 'ShaderNodeTexVoronoi')
            v.feature = 'F1'
            v.inputs['Scale'].default_value = 28.0
            L(nt, tc, v.inputs['Vector'])
            st = ramp(nt, v.outputs['Distance'], [(0.0, (1, 1, 1, 1)), (0.05, (0, 0, 0, 1))])
            hi = mathn(nt, 'MULTIPLY', mathn_sock(nt, st), mathn(nt, 'SUBTRACT', 1.0, cf))
            hi = mathn(nt, 'MULTIPLY', hi, ramp_val(nt, noise(nt, tc, 6.0, 1).outputs['Fac'], 0.6, 0.62))
            col = mixc(nt, hi, col, lin('#fff6c0'))
        nrm = bump(nt, noise(nt, tc, 120.0, 3, 0.5).outputs['Fac'], 0.08, 0.004)
        setp(b, rough=1.0, specular=0.0, emission_strength=s['emit'])
        L(nt, col, sock(b, 'emission'))
        _finish(m, nt, b, None, '#000000', nrm)
        setp(b, base=(0.0, 0.0, 0.0, 1.0))
        return m
    return _cached(f"sky_{kind}_{height}", build)


def ramp_val(nt, fac, a, b):
    r = ramp(nt, fac, [(a, (0, 0, 0, 1)), (b, (1, 1, 1, 1))])
    return mathn_sock(nt, r)


def ground(kind, hexc=None):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        if kind in ('grass', 'felt_green'):
            base = hexc or ('#5db24a' if kind == 'grass' else '#4fa95b')
            v1 = noise(nt, tc, 0.8, 3).outputs['Fac']
            col = mixc(nt, mathn(nt, 'MULTIPLY', v1, 0.9, clamp=True), lin(shade(base, 0.82)), lin(shade(base, 1.18)))
            fib = noise(nt, tc, 200.0, 8, 0.7, 0.3).outputs['Fac']
            fib2 = noise(nt, tc, 45.0, 5, 0.6).outputs['Fac']
            nrm = bump(nt, mathn(nt, 'ADD', fib, mathn(nt, 'MULTIPLY', fib2, 0.6)), 0.8, 0.02)
            lw = N(nt, 'ShaderNodeLayerWeight')
            col = mixc(nt, fresnel_mask(nt, lw, 0.12), col, lin(shade(base, 1.5)))
            setp(b, rough=0.95, specular=0.1, sheen=0.9, sheen_rough=0.5)
        elif kind == 'cobble':
            base = hexc or '#b9a98f'
            v = N(nt, 'ShaderNodeTexVoronoi')
            v.feature = 'F1'
            v.inputs['Scale'].default_value = 4.2
            L(nt, tc, v.inputs['Vector'])
            e = N(nt, 'ShaderNodeTexVoronoi')
            e.feature = 'DISTANCE_TO_EDGE'
            e.inputs['Scale'].default_value = 4.2
            L(nt, tc, e.inputs['Vector'])
            edge = ramp(nt, e.outputs['Distance'], [(0.04, (0, 0, 0, 1)), (0.12, (1, 1, 1, 1))])
            cellc = mixc(nt, mathn(nt, 'MULTIPLY', mathn_sock_vec(nt, v), 0.9, clamp=True), lin(shade(base, 0.94)), lin(shade(base, 1.1)))
            col = mixc(nt, mathn_sock(nt, edge), lin(shade(base, 0.72)), cellc)
            nrm = bump(nt, mathn(nt, 'ADD', mathn_sock(nt, edge), mathn(nt, 'MULTIPLY', noise(nt, tc, 30.0, 4).outputs['Fac'], 0.2)), 0.5, 0.03)
            setp(b, rough=0.7, specular=0.4)
        elif kind == 'snow':
            base = hexc or '#f4f8ff'
            n1 = noise(nt, tc, 0.7, 4, 0.55).outputs['Fac']
            col = mixc(nt, mathn(nt, 'MULTIPLY', n1, 0.6, clamp=True), lin(base), lin(shade(base, 0.86)))
            nrm = bump(nt, mathn(nt, 'ADD', n1, mathn(nt, 'MULTIPLY', noise(nt, tc, 60.0, 4).outputs['Fac'], 0.1)), 0.5, 0.04)
            setp(b, rough=0.55, specular=0.5, sheen=0.5, subsurface=0.15)
        else:  # sand
            base = hexc or '#ecd08a'
            w = N(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
            w.inputs['Scale'].default_value = 3.0
            w.inputs['Distortion'].default_value = 6.0
            L(nt, tc, w.inputs['Vector'])
            n1 = noise(nt, tc, 1.5, 3).outputs['Fac']
            col = mixc(nt, mathn(nt, 'MULTIPLY', mathn(nt, 'ADD', n1, w.outputs['Fac']), 0.35, clamp=True), lin(base), lin(shade(base, 0.85)))
            nrm = bump(nt, mathn(nt, 'ADD', w.outputs['Fac'], noise(nt, tc, 90.0, 4).outputs['Fac']), 0.35, 0.02)
            setp(b, rough=0.9, specular=0.15)
        return _finish(m, nt, b, col, base, nrm)
    return _cached(f"ground_{kind}_{hexc}", build)


def mathn_sock_vec(nt, vor):
    sep = N(nt, 'ShaderNodeSeparateColor')
    L(nt, vor.outputs['Color'], sep.inputs['Color'])
    return sep.outputs['Red']


def roof_tiles(hexc):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        br = N(nt, 'ShaderNodeTexBrick')
        br.inputs['Scale'].default_value = 9.0
        br.inputs['Mortar Size'].default_value = 0.03
        br.inputs['Brick Width'].default_value = 0.4
        br.inputs['Row Height'].default_value = 0.2
        hc = shade(hexc, 1.2)
        br.inputs['Color1'].default_value = lin(hc)
        br.inputs['Color2'].default_value = lin(shade(hc, 0.88))
        br.inputs['Mortar'].default_value = lin(shade(hc, 0.7))
        L(nt, tc, br.inputs['Vector'])
        nrm = bump(nt, br.outputs['Fac'], 0.5, 0.01)
        setp(b, rough=0.35, specular=0.5, coat=0.3)
        return _finish(m, nt, b, br.outputs['Color'], hexc, nrm)
    return _cached(f"tiles_{hexc}", build)


def brick(hexc):
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        br = N(nt, 'ShaderNodeTexBrick')
        br.inputs['Scale'].default_value = 7.0
        br.inputs['Mortar Size'].default_value = 0.04
        br.inputs['Color1'].default_value = lin(hexc)
        br.inputs['Color2'].default_value = lin(shade(hexc, 0.88))
        br.inputs['Mortar'].default_value = lin('#e9dcc4')
        L(nt, tc, br.inputs['Vector'])
        nrm = bump(nt, br.outputs['Fac'], 0.6, 0.01)
        setp(b, rough=0.6, specular=0.3)
        return _finish(m, nt, b, br.outputs['Color'], hexc, nrm)
    return _cached(f"brick_{hexc}", build)


def stripes(hexa, hexb, scale=6.0, axis='X'):
    """Painted stripes (awnings, barber-poles)."""
    def build(name):
        m, nt, b = _mat(name)
        tc = coords(nt)
        w = N(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction=axis, wave_profile='SAW')
        w.inputs['Scale'].default_value = scale
        w.inputs['Distortion'].default_value = 0.0
        L(nt, tc, w.inputs['Vector'])
        sq = ramp(nt, w.outputs['Fac'], [(0.0, (0, 0, 0, 1)), (0.49, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1))])
        col = mixc(nt, mathn_sock(nt, sq), lin(hexa), lin(hexb))
        nrm = bump(nt, noise(nt, tc, 60.0, 4).outputs['Fac'], 0.15, 0.004)
        setp(b, rough=0.8, specular=0.2, sheen=0.5)
        return _finish(m, nt, b, col, hexa, nrm)
    return _cached(f"stripes_{hexa}_{hexb}_{scale}_{axis}", build)
