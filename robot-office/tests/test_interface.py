import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class OfficeHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cards = []
        self.current_card = None
        self.sections = set()
        self.script_srcs = []
        self.stylesheet_hrefs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "article" and "robot-card" in attrs.get("class", "").split():
            self.current_card = {"category": attrs.get("data-category"), "text": ""}
            self.cards.append(self.current_card)
        elif tag == "section" and attrs.get("id"):
            self.sections.add(attrs["id"])
        elif tag == "script" and attrs.get("src"):
            self.script_srcs.append(attrs["src"])
        elif tag == "link" and attrs.get("rel") == "stylesheet":
            self.stylesheet_hrefs.append(attrs.get("href", ""))

    def handle_data(self, data):
        if self.current_card is not None:
            self.current_card["text"] += data

    def handle_endtag(self, tag):
        if tag == "article":
            self.current_card = None


class RobotOfficeInterfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "robot-office.html").read_text(encoding="utf-8")
        cls.parser = OfficeHTMLParser()
        cls.parser.feed(cls.html)

    def test_all_specialists_have_explicit_categories(self):
        self.assertEqual(len(self.parser.cards), 12)
        self.assertTrue(all(card["category"] for card in self.parser.cards))
        self.assertEqual(
            {card["category"] for card in self.parser.cards},
            {"security", "operations", "finance", "legal", "data"},
        )

    def test_treasury_and_legal_specialists_are_present(self):
        text = " ".join(card["text"] for card in self.parser.cards)
        self.assertIn("Treasury Guard", text)
        self.assertIn("Legal Counsel AI", text)

    def test_search_and_filter_controls_are_present(self):
        self.assertIn('data-robot-search', self.html)
        self.assertIn('data-robot-filter="all"', self.html)
        self.assertIn('aria-live="polite"', self.html)
        self.assertIn('data-robot-empty', self.html)

    def test_operating_workflow_and_content_library_are_present(self):
        self.assertIn('id="workflow-title"', self.html)
        self.assertIn('id="content-title"', self.html)
        self.assertIn("Стандарт доказательств", self.html)
        self.assertIn("Передача ЖАКу", self.html)
        self.assertIn("Финансовая сверка", self.html)
        self.assertIn("Юридический разбор", self.html)

    def test_assets_are_referenced_and_exist(self):
        self.assertIn("/assets/css/robot-office.css", self.parser.stylesheet_hrefs)
        self.assertIn("/assets/js/robot-office.js", self.parser.script_srcs)
        self.assertTrue((ROOT / "assets/css/robot-office.css").is_file())
        self.assertTrue((ROOT / "assets/js/robot-office.js").is_file())

    def test_no_false_claim_of_live_connection(self):
        self.assertIn("не подключён", self.html.lower())
        self.assertIn("не активированы", self.html.lower())
        self.assertIn("не являются подтверждением работающих агентов", self.html)


if __name__ == "__main__":
    unittest.main()
