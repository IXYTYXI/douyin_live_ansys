import unittest
from backend.reviews import validate_fields
class SummaryLimits(unittest.TestCase):
 def test_generated_keywords_have_twelve_limit(self):
  self.assertEqual(len(validate_fields({'keywords':['词']*12},keyword_limit=12)['keywords']),12)
  with self.assertRaises(ValueError):validate_fields({'keywords':['词']*13},keyword_limit=12)
 def test_manual_limit_unchanged(self):
  self.assertEqual(len(validate_fields({'keywords':['词']*30})['keywords']),30)
