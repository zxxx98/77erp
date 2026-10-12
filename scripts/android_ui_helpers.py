"""Geometry and scrolling for the native UI smoke check (no device needed on import)."""
import re
import time


def bounds(node):
    values = tuple(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))
    if len(values) != 4:
        raise ValueError(f"Invalid native bounds: {node.get('bounds')}")
    return values


def intersection(a, b):
    return max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])


def has_area(rect):
    return rect[2] > rect[0] and rect[3] > rect[1]


def scroll_to_action(label, read_tree, swipe, screen_size, density, timeout=180):
    """Find a usable action, scrolling within the actual viewport until content stops."""
    screen = (0, 0, *screen_size)
    minimum = round(48 * density / 160)
    deadline = time.monotonic() + timeout
    previous, unchanged = None, 0
    while time.monotonic() < deadline:
        root = read_tree()
        # Horizontal chip lists must not be mistaken for the form's vertical scroll view.
        views = [intersection(bounds(n), screen) for n in root.iter('node')
                 if n.get('scrollable') == 'true' and n.get('class') == 'android.widget.ScrollView']
        views = [r for r in views if has_area(r)]
        viewport = max(views, key=lambda r: (r[2] - r[0]) * (r[3] - r[1])) if views else screen
        for node in root.iter('node'):
            if (label not in (node.get('text'), node.get('content-desc')) or
                    node.get('enabled') == 'false' or
                    not (node.get('class') == 'android.widget.Button' or node.get('clickable') == 'true')):
                continue
            rect = bounds(node)
            if (intersection(rect, viewport) == rect and
                    rect[2] - rect[0] >= minimum and rect[3] - rect[1] >= minimum):
                return node
        if not views:
            raise RuntimeError(f"Cannot scroll to native action {label!r}: no vertical scroll view")
        # Ignore stale offscreen nodes and refuse an endless swipe when scrolling stalls.
        visible = tuple((n.get('text'), n.get('content-desc'), n.get('bounds'))
                        for n in root.iter('node') if has_area(intersection(bounds(n), viewport)))
        unchanged = unchanged + 1 if visible == previous else 0
        if unchanged >= 3:
            raise RuntimeError(f"Cannot scroll to native action {label!r}: content stopped moving")
        previous = visible
        x = (viewport[0] + viewport[2]) // 2
        height = viewport[3] - viewport[1]
        swipe(x, viewport[1] + round(height * 0.85), x, viewport[1] + round(height * 0.15))
    raise RuntimeError(f"Cannot scroll to native action {label!r}: timed out after {timeout}s")
