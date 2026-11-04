"""Division agent: reviews riders whose vELO cannot be trusted and proposes a division.

Flow: triage (who needs a look) -> queue -> evidence (predictions, data-quality flags)
-> decide (deterministic suggestion) -> assess (Claude writes rationale and the Danish
rider text) -> proposal. An admin approves, edits or rejects every proposal; nothing
changes a rider's division without that click.
"""
