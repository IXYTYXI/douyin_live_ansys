import unittest
from backend.metric_projection import review_samples
class MetricProjectionTests(unittest.TestCase):
 def test_snapshot_and_legacy_online_are_preserved(self):
  rows=[(0,{'metrics':{'online':{'value':12},'likes':{'value':1200,'raw':'1.2千','approximate':True},'shares':{'value':0},'private':{'value':9}}}),(10,{'metrics':{'online':{'value':None}}}),(30,{'metrics':{}})]
  result=review_samples(rows,30)
  self.assertEqual(len(result),2)
  self.assertEqual(result[0]['value'],12)
  self.assertEqual(result[0]['metrics']['likes']['value'],1200)
  self.assertTrue(result[0]['metrics']['likes']['approximate'])
  self.assertEqual(result[0]['metrics']['shares']['value'],0)
  self.assertNotIn('private',result[0]['metrics'])
  self.assertIsNone(result[1]['value'])
 def test_non_numeric_values_are_missing(self):
  row={'metrics':{'online':None,'likes':{'value':'7'},'shares':{'value':True}}}
  sample=review_samples([(0,row)],10)[0]
  self.assertIsNone(sample['value'])
  self.assertIsNone(sample['metrics']['likes']['value'])
  self.assertIsNone(sample['metrics']['shares']['value'])
