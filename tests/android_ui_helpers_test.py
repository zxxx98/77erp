"""Regression checks for the release smoke test's device-independent navigation."""
import pathlib
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from android_ui_helpers import bounds, scroll_to_action


def screen(content='', viewport='[96,266][1800,888]'):
    return ET.fromstring(f'<hierarchy><node bounds="[0,0][1800,960]">'
                        f'<node class="android.widget.ScrollView" scrollable="true" bounds="{viewport}">'
                        f'{content}</node></node></hierarchy>')


def button(rect, label='保存物料'):
    return f'<node class="android.widget.Button" content-desc="{label}" bounds="{rect}" />'


class ScrollNavigationTests(unittest.TestCase):
    def test_signed_offscreen_bounds_are_not_misread_as_visible(self):
        node = ET.fromstring('<node bounds="[216,266][1680,-183]" />')
        self.assertEqual(bounds(node), (216, 266, 1680, -183))

    def test_long_form_scrolls_beyond_the_old_twelve_swipe_limit(self):
        pages = [screen(f'<node text="field-{i}" bounds="[216,489][1680,667]" />') for i in range(20)]
        pages.append(screen(button('[216,600][1680,800]')))
        swipes = []
        found = scroll_to_action('保存物料', lambda: pages[min(len(swipes), len(pages)-1)],
                                 lambda *points: swipes.append(points), (1800, 960), 480)
        self.assertEqual(len(swipes), 20)
        self.assertEqual(found.get('content-desc'), '保存物料')
        # Gestures remain inside the real scroll area, above Android's navigation inset.
        for x1, y1, x2, y2 in swipes:
            self.assertTrue(96 < x1 == x2 < 1800)
            self.assertTrue(266 < y2 < y1 < 888)

    def test_partial_action_scrolls_until_a_full_touch_target_is_visible(self):
        pages = [screen(button('[216,820][1680,888]')), screen(button('[216,650][1680,850]'))]
        swipes = []
        result = scroll_to_action('保存物料', lambda: pages[min(len(swipes), 1)],
                                  lambda *points: swipes.append(points), (1800, 960), 480)
        self.assertEqual(len(swipes), 1)
        self.assertEqual(bounds(result), (216, 650, 1680, 850))

    def test_touch_target_uses_device_density_and_accepts_a_text_label(self):
        root = screen('<node class="android.widget.Button" text="保存物料" bounds="[100,400][300,464]" />')
        self.assertIsNotNone(scroll_to_action('保存物料', lambda: root, lambda *_: self.fail('Unexpected swipe'),
                                             (1800, 960), 160))

    def test_stalled_form_fails_instead_of_hiding_an_unreachable_action(self):
        root = screen('<node text="last-field" bounds="[216,489][1680,667]" />')
        swipes = []
        with self.assertRaisesRegex(RuntimeError, 'content stopped moving'):
            scroll_to_action('保存物料', lambda: root, lambda *points: swipes.append(points), (1800, 960), 480)
        self.assertEqual(len(swipes), 3)

    def test_horizontal_chip_list_is_not_used_as_the_form_viewport(self):
        root = screen('<node class="android.widget.HorizontalScrollView" scrollable="true" bounds="[0,0][1800,960]" />')
        swipes = []
        with self.assertRaisesRegex(RuntimeError, 'content stopped moving'):
            scroll_to_action('保存物料', lambda: root, lambda *points: swipes.append(points), (1800, 960), 480)
        self.assertTrue(all(266 < points[3] < points[1] < 888 for points in swipes))


if __name__ == '__main__':
    unittest.main()
