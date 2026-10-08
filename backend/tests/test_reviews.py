import unittest
from backend.reviews import validate_fields
from backend.summary_worker import windows

class ReviewTests(unittest.TestCase):
    def test_valid_manual_notes(self):
        value={'periodTheme':'分数应用题','keywords':['分数'],'conclusion':'人工判断','adjustment':''}
        self.assertEqual(validate_fields(value),value)
    def test_invalid_fields_and_limits(self):
        for value in [{'periodTheme':'长'*17},{'keywords':['']},{'conclusion':12},{'unexpected':True}]:
            with self.assertRaises(ValueError):validate_fields(value)
    def test_tail_and_top_ranges(self):
        self.assertEqual(windows(450.43),[(0,450.43)])
        self.assertIn((600,650),windows(650))
        self.assertIn((0,650),windows(650))
        self.assertEqual(len(windows(1800)),4)
