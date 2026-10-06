# Institution integration API

Use this API to issue and revoke badges from a learning system, track completion, and reconcile issued credentials. It works with both the hosted Worker and the Docker Node runtime.

The OpenAPI document is available at `/v1/programmatic/openapi.json`. A checked-in copy is in [programmatic.openapi.json](openapi/programmatic.openapi.json). The request and response schemas generate both copies. Regenerate the snapshot with `pnpm export:programmatic-openapi`.

## Authentication and permissions

Create an institution API key in the administrator's API keys page. Enter only the permissions the integration needs, separated by commas:

| Scope | Permits |
|---|---|
| `queue.issue` | Queue issuance |
| `queue.revoke` | Queue revocation |
| `operations.read` | Read issuance and revocation progress for this institution |
| `templates.read` | List and read badge templates for this institution |
| `assertions.read` | List and read issued badges, including recipient identities, for this institution |

Send the key in `x-api-key`. All endpoints require `tenantId`, either in the write body or in the read query. It must match the key's institution. Administrator sessions are not required for these endpoints. Never embed an API key in a browser app or a public URL.

A key created without explicit scopes has `queue.issue` and `queue.revoke`. Read permissions must be requested explicitly; existing write keys do not automatically gain access to recipient data. To use the full workflow below, create a key with all five scopes. Keys cannot change their permissions: create a replacement key, update the integration, and revoke the previous key. A key with `*` grants all supported permissions.

Writes require the key's owning user for audit attribution. Read-only keys do not require a write actor. Revoked and expired keys are rejected for both reads and writes. Successful authentication updates the key's last-used time.

## Endpoints

| Method | Path | Permission |
|---|---|---|
| POST | `/v1/programmatic/issue` | `queue.issue` |
| POST | `/v1/programmatic/revoke` | `queue.revoke` |
| GET | `/v1/programmatic/operations/{operationId}` | `operations.read` |
| GET | `/v1/programmatic/templates` | `templates.read` |
| GET | `/v1/programmatic/templates/{badgeTemplateId}` | `templates.read` |
| GET | `/v1/programmatic/assertions` | `assertions.read` |
| GET | `/v1/programmatic/assertions/{assertionId}` | `assertions.read` |

The OpenAPI document itself is public. Authenticated responses use `Cache-Control: no-store`. Public links use `PUBLIC_APP_ORIGIN`, including behind a TLS proxy.

## Issue, check completion, and download

Set `BASE_URL` to your public HTTPS origin, `TENANT_ID` to your institution ID, and `API_KEY` to your integration key in your local environment. The examples use `jq` to read JSON responses.

Discover a badge template:

```sh
curl --fail-with-body --get "$BASE_URL/v1/programmatic/templates" \
  -H "x-api-key: $API_KEY" \
  --data-urlencode "tenantId=$TENANT_ID" \
  --data-urlencode "limit=50"
```

Each template includes `badgeTemplateId`, `title`, `description`, `criteriaUrl`, `imageUrl`, and `archived`. Archived templates are excluded from the list by default. Pass `includeArchived=true` to include them; individual template reads can return an archived template. Managed artwork links use the configured public origin; templates without managed artwork return a null image URL. A template still needs usable artwork before it can issue a badge.

Set `TEMPLATE_ID` to the selected template's ID. Submit one award:

```sh
PAYLOAD=$(jq -n \
  --arg tenant "$TENANT_ID" --arg template "$TEMPLATE_ID" \
  '{tenantId: $tenant, badgeTemplateId: $template,
    recipientIdentity: "learner@example.edu", recipientIdentityType: "email",
    idempotencyKey: "course-101-completion-student-123-v1"}')

ACCEPTED=$(curl --fail-with-body "$BASE_URL/v1/programmatic/issue" \
  -H "x-api-key: $API_KEY" -H 'Content-Type: application/json' \
  --data "$PAYLOAD")
STATUS_URL=$(printf '%s' "$ACCEPTED" | jq -r '.statusUrl')
ASSERTION_ID=$(printf '%s' "$ACCEPTED" | jq -r '.assertionId')
```

The response is **202 Accepted**. It contains `status: "queued"`, `channel`, `jobType`, `assertionId`, `idempotencyKey`, `operationId`, and `statusUrl`. The `Location` header also contains the status URL. Acceptance confirms the command is persisted; the badge has not necessarily been issued yet.

Required issuance fields are `tenantId`, `badgeTemplateId`, `recipientIdentity`, `recipientIdentityType`, and `idempotencyKey`. Optional fields are `recipientDisplayName`, `recipientIdentifiers`, and `issuerImageUri`. Recipient identity types are `email`, `email_sha256`, `did`, and `url`. See OpenAPI for identifier shapes and limits. Unknown body fields are rejected; the caller cannot set the audit actor or assertion ID.

Check completion with the same key:

```sh
OPERATION=$(curl --fail-with-body "$STATUS_URL" -H "x-api-key: $API_KEY")
printf '%s\n' "$OPERATION" | jq
```

| Status | Meaning | Next step |
|---|---|---|
| `pending` | Waiting for a worker, or scheduled for another attempt | Wait until `nextAttemptAt` and poll again |
| `processing` | A worker is handling the command | Poll again |
| `completed` | Processing succeeded | Use `result.badgeUrl` or `result.credentialUrl` |
| `failed` | Processing ended in terminal failure | Check worker diagnostics using `operationId` before deciding whether to submit a new request |

Pending and processing responses include `Retry-After: 5`. Keep polls at least five seconds apart and respect a later `nextAttemptAt`. Every status includes the operation ID, institution, job type, assertion ID, idempotency key, attempt count, and creation/update timestamps. Completed responses add `completedAt` and public links. Failed responses add `failedAt` and a safe `failure` object. Raw database, SMTP, storage, and worker errors are not returned.

Completion confirms the issuance or revocation command succeeded. It does not guarantee that an issuance email was delivered. If the assertion is no longer available, a completed operation's public links are null. An operation lookup does not trigger processing; self-hosted installations need a running worker.

After the operation is completed, download the signed credential:

```sh
CREDENTIAL_URL=$(printf '%s' "$OPERATION" | jq -r '.result.credentialUrl')
curl --fail-with-body "$CREDENTIAL_URL" --output credential.jsonld
```

## Retry safely

Use a stable `idempotencyKey` for each logical award or revocation. Retry timeouts and lost responses with **the same key and the same body**. A matching replay returns the original assertion, operation ID, and status URL. It does not create a second badge or restart a terminal failure.

Reusing a key with different request content returns **409** with `code: "idempotency_conflict"`. Keys are scoped to institution and command type; issuance and revocation have separate key spaces. A replay remains bound to its original achievement snapshot even if the template is subsequently edited or archived.

Poll the operation to learn its current state: the replayed write response still says `queued` because it acknowledges the original accepted command. Do not infer current processing state from that response. Investigate failures before choosing a new idempotency key, because earlier attempts may have produced effects before failing.

## Read and reconcile issued badges

Get one assertion, including its current lifecycle state:

```sh
curl --fail-with-body --get \
  "$BASE_URL/v1/programmatic/assertions/$(printf '%s' "$ASSERTION_ID" | jq -sRr @uri)" \
  -H "x-api-key: $API_KEY" --data-urlencode "tenantId=$TENANT_ID"
```

Each assertion includes `assertionId`, `badgeTemplateId`, `recipientIdentity`, `recipientIdentityType`, `issuedAt`, `validUntil`, `state`, `badgeUrl`, and `credentialUrl`. States are `active`, `suspended`, `revoked`, and `expired`. Expiry is calculated when read; it does not wait for a scheduled worker. Public links are null for records without a public badge identifier. These reads do not return storage keys, signed credential blobs, or administrative metadata.

List a recipient's awards within a date range:

```sh
curl --fail-with-body --get "$BASE_URL/v1/programmatic/assertions" \
  -H "x-api-key: $API_KEY" \
  --data-urlencode "tenantId=$TENANT_ID" \
  --data-urlencode "recipientIdentity=learner@example.edu" \
  --data-urlencode "recipientIdentityType=email" \
  --data-urlencode "badgeTemplateId=$TEMPLATE_ID" \
  --data-urlencode "issuedFrom=2026-10-01" \
  --data-urlencode "issuedTo=2026-10-31" \
  --data-urlencode "limit=50"
```

All filters except `tenantId` are optional. Recipient matching is exact; email matching ignores case, while DID, URL, and hashed identities are case-sensitive. Date filters use inclusive UTC calendar dates (`YYYY-MM-DD`). `issuedTo` must be on or after `issuedFrom`.

Both lists return `tenantId`, their resource array, and `nextCursor`. `limit` defaults to 50 and must be between 1 and 100. Results sort by immutable resource ID ascending. To continue, pass the returned `nextCursor` as `cursor`, keeping the same filters. Stop when `nextCursor` is null. Pagination is a live view, not a frozen export; inserts or changes between pages can affect the matching set. For ongoing reconciliation, repeat overlapping date ranges and deduplicate by `assertionId`.

## Revoke and track completion

```sh
REVOKE_PAYLOAD=$(jq -n --arg tenant "$TENANT_ID" --arg assertion "$ASSERTION_ID" \
  '{tenantId: $tenant, assertionId: $assertion,
    reason: "Award withdrawn by the institution",
    idempotencyKey: "course-101-withdrawal-student-123-v1"}')

curl --fail-with-body "$BASE_URL/v1/programmatic/revoke" \
  -H "x-api-key: $API_KEY" -H 'Content-Type: application/json' \
  --data "$REVOKE_PAYLOAD"
```

All fields shown are required. The accepted response also includes `revocationId`. Follow its `statusUrl` until completion, then read the assertion to confirm its current state. An unknown assertion can be accepted into the queue and later fail during processing; acceptance is not revocation success.

## Errors and troubleshooting

Handled errors contain `code` and `error`; validation errors also contain field paths in `details`. Branch on `code`, rather than matching message text.

| HTTP | Codes | Action |
|---|---|---|
| 400 | `invalid_request` | Correct JSON, fields, filters, or page parameters |
| 401 | `api_key_required`, `invalid_api_key` | Supply a valid, unexpired, unrevoked key |
| 403 | `tenant_mismatch`, `insufficient_scope` | Use the correct institution and a key with the required scope |
| 403 | `invalid_api_key_scopes`, `api_key_owner_required` | Create a correctly configured replacement key with an owning user for writes |
| 404 | `operation_not_found`, `template_not_found`, `assertion_not_found` | Check the resource ID and institution; foreign resources are not disclosed |
| 409 | `idempotency_conflict` | Restore the original request or use a key for a distinct logical command |
| 409 | `template_archived`, `artwork_required` | Select an active template and attach usable artwork |
| 503 | `storage_unavailable` | Retry the same request with the same idempotency key after storage recovers |

A status read can return HTTP 200 with `status: "failed"`: the lookup succeeded, but the command failed. Its `failure.code` is `operation_failed`. Other unexpected server failures use the app's normal server-error response; do not assume their bodies follow the handled-error schema. Use the response's `x-request-id` when asking an operator to investigate. On an ambiguous write failure, retry the same idempotency key rather than creating a new award.
