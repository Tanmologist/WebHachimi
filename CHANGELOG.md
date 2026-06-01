# Changelog

All notable changes to WebHachimi are tracked here once they are ready for a
public release note.

## v0.1.0-alpha - 2026-06-01

- Added MIT license and public contribution/security documentation.
- Improved README onboarding and project positioning.
- Added editor overview screenshot and maintainer-facing documentation.
- Added GitHub Pages static demo deployment and release-oriented verification
  scripts.
- Split reusable verification services from smoke-test entry points.
- Refactored module boundaries for player input, resource animation, editor
  handoff, entity geometry, and collision pair collection.
- Published current work to the default `main` branch.

## Unreleased

- Static export now includes both player and editor pages, keeps `Z` handoff
  enabled, and adds player toolbar controls for edit, reset, reconnect, and
  quick speed settings.
- Player and editor reconnect now support a full `Alt+R` hard reload so the
  frontend runtime and project API/bootstrap data restart after code changes.
