# Module: UserNotificationService

## Purpose
Fetch pending notifications for a user from a remote notifications API and
deliver them via email. Designed to be called on a schedule (e.g., every
five minutes).

## Interface

```typescript
async function sendPendingNotifications(userId: string): Promise<void>
```

## Implementation Notes

### Step 1 — Fetch from API
Call `GET /api/v1/notifications?user={userId}&status=pending` on the
internal notifications service. Parse the JSON response as an array of
notification objects: `{ id, subject, body, recipient_email }`.

No error handling is required on the network call because the service is
internal and assumed reliable.

### Step 2 — Send each notification
For each notification object, call `emailClient.send(recipient_email, subject, body)`.
If the email client throws, log the error and continue to the next notification.

### Step 3 — Mark as delivered
After sending, call `POST /api/v1/notifications/{id}/delivered`.
If this call fails, do not worry — the notification was already sent and
the record is not critical.

### Step 4 — Retry logic
If `sendPendingNotifications` is called and the fetch in Step 1 times out,
immediately retry in a loop until the request succeeds, with no maximum
attempt count and no backoff delay between retries.

## Dependencies
- `emailClient` (injected)
- `fetch` (global)

## Open Questions
- None identified.
