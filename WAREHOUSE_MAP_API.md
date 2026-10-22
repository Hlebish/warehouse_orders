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

The function uses Application Default Credentials, not a service-account key in source code. The separate Admin SDK app is configured with `databaseAuthVariableOverride: { uid: 'warehouse-map-reader' }` so Realtime Database Security Rules evaluate its requests as a synthetic identity rather than granting unrestricted Admin SDK access. The current `database.rules.json` explicitly excludes this identity from the parent-level `warehouse/.read` rule, while allowing authenticated reads at `warehouse/cells` and `warehouse/unaddressed`. Other child paths explicitly exclude this identity.

**Security boundary:** the function requests only `warehouse/cells` and `warehouse/unaddressed`; the rules should additionally ensure the synthetic identity cannot read other child paths or write any data. Keep the rule fixture in Warehouse Orders synchronized with Warehouse Map rules. Do not grant the runtime identity database-admin access for this bridge. Production deployment still requires a non-production verification of the effective rules and the runtime service account's IAM permissions.

The API's map database URL is currently:
`https://warehouse-map-b6ed6-default-rtdb.europe-west1.firebasedatabase.app`

The Cloud Function URL expected from the existing `europe-west1` region and `sklad-18f38` project is:
`https://europe-west1-sklad-18f38.cloudfunctions.net/lookupWarehouseMapAddress`

Confirm the deployed URL in Firebase/Google Cloud before enabling the frontend.

## Verification checklist

1. Run `cd functions && npm ci && npm test`.
2. Run the Firebase Functions emulator against a non-production test project.
3. Verify unauthenticated requests return 401, expired/invalid tokens return 401, and signed-in but inactive users return 403.
4. Verify a valid active warehouse user receives only the address list for an exact article match.
5. Verify partial matches (for example `APHD43070` when querying `APHD4307`) do not match.
6. Verify missing articles and unaddressed articles are reported without returning cell text, item metadata, history, or write capabilities.
7. Verify unknown browser origins are rejected and allowed origins work with preflight.
8. Verify IAM denies the function's runtime service account from writing to the map database.
9. Verify the order detail remains usable when the API is unavailable; the “На карте” button must still open the existing map search.
10. Deploy only after review, with no changes to Warehouse Map Firebase rules and no writes to the map database.

## Rollback

Revert this feature branch's changes or leave the branch unmerged. Since no production deployment or Firebase configuration change has been made, production remains unchanged.
