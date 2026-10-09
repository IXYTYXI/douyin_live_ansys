"""Expose collected numeric snapshots without deriving or inventing values."""
import math

METRICS = ('online', 'previewOnline', 'giftUsers', 'newFollowers',
           'commentUsers', 'likes', 'shares', 'fanClubJoins')


def review_samples(rows, duration):
    result = []
    for timestamp, payload in rows:
        t = float(timestamp)
        if not 0 <= t < duration:
            continue
        source = payload.get('metrics') or {}
        metrics = {}
        for key in METRICS:
            raw = source.get(key)
            if not isinstance(raw, dict):
                continue
            value = raw.get('value')
            valid = type(value) in (int, float) and math.isfinite(value) and value >= 0
            metrics[key] = {'value': value if valid else None,
                            'approximate': raw.get('approximate') is True}
        result.append({'t': t, 'value': metrics.get('online', {}).get('value'),
                       'metrics': metrics})
    return result
