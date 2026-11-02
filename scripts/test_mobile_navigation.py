from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "assets/css/style.css").read_text(encoding="utf-8")

class MobileNavigationTests(unittest.TestCase):
    def test_mobile_breakpoint_and_open_state(self):
        self.assertRegex(CSS, r"@media\s*\(max-width:\s*700px\)")
        self.assertRegex(CSS, r"\.main-navigation\.active\s*\{[^}]*display:\s*flex", re.S)

    def test_menu_fits_dynamic_viewport_and_scrolls(self):
        self.assertIn("max-height: calc(100dvh - 110px)", CSS)
        self.assertIn("overflow-y: auto", CSS)
        self.assertIn("-webkit-overflow-scrolling: touch", CSS)
        self.assertIn("overscroll-behavior: contain", CSS)

    def test_touch_targets_and_wrapping(self):
        self.assertIn("min-width: 44px", CSS)
        self.assertIn("min-height: 44px", CSS)
        self.assertIn("overflow-wrap: anywhere", CSS)
        self.assertIn("touch-action: manipulation", CSS)

    def test_short_viewport_and_narrow_phone_rules(self):
        self.assertRegex(CSS, r"@media\s*\(max-width:\s*700px\)\s*and\s*\(max-height:\s*650px\)")
        self.assertRegex(CSS, r"@media\s*\(max-width:\s*380px\)")

if __name__ == "__main__":
    unittest.main(verbosity=2)
