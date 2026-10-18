#!/usr/bin/env python3
"""Recompute nearest-rank pointer percentiles; retain activation failures."""
import json, math, pathlib
raw = pathlib.Path(__file__).resolve().parents[1] / 'raw'
def percentile(rows):
    return sorted(row['ms'] for row in rows)[math.ceil(len(rows) * .95) - 1]
result = {}
for variant in ['baseline', 'current']:
    runs = []
    for number in range(1, 4):
        data = json.loads((raw / f'matched-{variant}-{number}.json').read_text())
        rows = [row for row in data['samples'] if row.get('previousContextId') != row['id']]
        assert all(row['viewport'] == [800, 1020] for row in rows)
        runs.append(rows)
    result[variant] = {
        'runs': [{'attempts': len(rows), 'activated': sum(row['selected'] for row in rows),
                  'timeouts': sum(row.get('timeout', False) for row in rows), 'p95Ms': percentile(rows)} for rows in runs],
        'allThreeP95Ms': percentile(sum(runs, [])),
        'matchedRunsTwoAndThreeP95Ms': percentile(runs[1] + runs[2]),
    }
result['matchedChangePercent'] = (result['current']['matchedRunsTwoAndThreeP95Ms'] / result['baseline']['matchedRunsTwoAndThreeP95Ms'] - 1) * 100
print(json.dumps(result, indent=2))
