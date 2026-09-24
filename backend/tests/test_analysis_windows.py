import unittest
from backend.analysis import windows
class WindowTest(unittest.TestCase):
 def test_relative_to_live_start_and_partial_tail(self):
  self.assertEqual(windows(1000,1600),[(0,600)])
  self.assertEqual(windows(1000,1599),[])
  self.assertEqual(windows(1000,1900,ended_at=1850),[(0,600),(600,850)])
 def test_end_in_future_rejected(self):
  with self.assertRaises(ValueError): windows(1000,1500,ended_at=1800)
