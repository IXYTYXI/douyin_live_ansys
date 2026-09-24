"""Plan ten-minute live-relative analysis ranges; never infer live end from silence."""
import math

def windows(started_at, now, ended_at=None):
    values=[started_at,now]+([] if ended_at is None else [ended_at])
    if not all(math.isfinite(v) for v in values):
        raise ValueError('timestamps must be finite')
    if now<started_at or (ended_at is not None and not started_at<=ended_at<=now):
        raise ValueError('invalid session timestamps')
    duration=(now if ended_at is None else ended_at)-started_at
    full=int(duration//600)
    result=[(n*600,(n+1)*600) for n in range(full)]
    if ended_at is not None and duration>full*600:
        result.append((full*600,duration))
    return result
