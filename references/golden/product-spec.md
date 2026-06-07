# Feature Spec: Saved Search Alerts

## Overview
Allow users to save a search query and receive an email notification
whenever a new listing matches it. Intended to reduce churn among
high-intent users who check the platform repeatedly.

## User Story
As a job-seeker, I want to save a search so that I get an email when a
new matching listing is posted, without having to visit the platform daily.

## Scope
- Users can save up to 5 searches.
- Email alerts are sent at most once per day per saved search.
- Users can delete a saved search at any time.
- Alerts are delivered at 8 AM in the user's timezone.

## Out of Scope
- Push notifications (mobile)
- In-app notification inbox

## Acceptance Criteria

1. A logged-in user can click "Save Search" on any search results page.
2. The system stores the query parameters associated with the saved search.
3. A daily job evaluates each saved search and emails the user a digest of
   new matches published since the last alert.
4. The user can manage (view and delete) saved searches from their
   account settings page.
5. If no new matches exist, no email is sent.

## Technical Notes
- Saved searches stored in `saved_searches` table: `(id, user_id, query_json, last_alerted_at)`.
- Daily job runs via cron at 07:45 UTC to cover 8 AM local across major timezones.
- Email rendered using the existing transactional email template.

## Open Questions
- Should alerts be paused if the user has not logged in for 30 days?
