# Warehouse Map read-only API integration

This feature branch adds a read-only API bridge from Warehouse Orders to the separate Warehouse Map Realtime Database. It does not deploy Firebase resources, change database rules, or modify the production branch.

## What changed

- `POST /lookupWarehouseMapAddress` is an HTTPS Cloud Function in the Warehouse Orders Firebase project.
- The caller must send a valid Firebase ID token from the Warehouse Orders project.
- The function verifies the token, then checks `users/{uid}.active === true` in Firestore.
- The function reads only `warehouse/cells` and `warehouse/unaddressed` from the map database and returns matching addresses, not cell contents or history.
- Order details request locations in batches and display addresses under article codes. The existing “На карте” button and its article query remain unchanged.
- API responses use `Cache-Control: no-store`; the browser request uses `cache: no-store`.

## Required infrastructure setup (not performed)

The function uses Application Default Credentials, not a service-account key in source code. The separate Admin SDK app is configured with `databaseAuthVariableOverride: { uid: 'warehouse-map-reader' }` so Realtime Database Security Rules evaluate its requests as a synthetic identity rather than granting unrestricted Admin SDK access. The checked-in rules in [Warehouse Map](https://github.com/Hlebish/warehouse-map/blob/main/database.rules.json) exclude this identity from the parent-level `warehouse/.read` rule and allow authenticated reads at `warehouse/cells` and `warehouse/unaddressed`. The emulator CI test uses a checked-in fixture copy at `test-fixtures/warehouse-map.database.rules.json`; it does not read or verify the rules currently deployed in Firebase.

**Observed live-rules blocker (rules copied from Firebase Console by the operator on 2026-10-22):** the supplied rules have `warehouse/.read: auth != null` and do not exclude `warehouse-map-reader`. A parent-level RTDB read grant flows to its descendants, so this permits every authenticated identity—including the synthetic bridge identity—to read the entire `warehouse` subtree. It also grants that broad read to any authenticated user of the map project. This differs from the checked-in rules. Do not enable the API against the supplied rules. The rules have not been independently fetched by CI or changed by this PR.

**Required security boundary:** before enabling the bridge, an authorized owner must reconcile the deployed RTDB rules with the reviewed source and verify them in a non-production database. The source rules currently deny the synthetic identity at `warehouse` and explicitly allow it to read only `cells` and `unaddressed`. The emulator CI test verifies the source fixture, not the deployed rules. Also verify the runtime service account's effective IAM permissions; no IAM changes or production rule changes have been made.

The API's map database URL is currently:
`https://warehouse-map-b6ed6-default-rtdb.europe-west1.firebasedatabase.app`

The Cloud Function URL expected from the existing `europe-west1` region and `sklad-18f38` project is:
`https://europe-west1-sklad-18f38.cloudfunctions.net/lookupWarehouseMapAddress`

Confirm the deployed URL in Firebase/Google Cloud before enabling the frontend.

## Verification checklist

1. Run `cd functions && npm ci && npm test`.
2. In a non-production project, verify the intended rules deny reads at `warehouse` for `warehouse-map-reader`, allow reads at `warehouse/cells` and `warehouse/unaddressed`, deny reads at other children, and deny writes.
3. Verify unauthenticated requests return 401, expired/invalid tokens return 401, and signed-in but inactive users return 403.
4. Verify a valid active warehouse user receives only the address list for an exact article match.
5. Verify partial matches (for example `APHD43070` when querying `APHD4307`) do not match.
6. Verify missing articles and unaddressed articles are reported without returning cell text, item metadata, history, or write capabilities.
7. Verify unknown browser origins are rejected and allowed origins work with preflight.
8. Verify the runtime service account cannot write to the map database and has no database-admin role.
9. Verify the order detail remains usable when the API is unavailable; the “На карте” button must still open the existing map search.
10. Enable the frontend only after review and non-production verification. Any production rule or IAM change requires separate explicit authorization.

## Rollback

Revert this feature branch's changes or leave the branch unmerged. Since no production deployment or Firebase configuration change has been made, production remains unchanged.
