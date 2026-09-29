# Realtime push upgrade

This upgrade moves warehouse push notifications from the old GitHub Actions 5-minute polling approach to Firebase Cloud Functions 2nd gen.

After applying:

1. Switch Firebase project `sklad-18f38` to Blaze.
2. Run `node apply-push-upgrade.cjs` in the repository root.
3. Run `npm install -g firebase-tools`.
4. Run `firebase login`.
5. Run `firebase deploy --only functions`.
6. Open the website on each phone/PC and enable notifications once.

The function listens to `pushQueue/{eventId}` and sends FCM data messages to all active users and all registered devices.

Cloud Functions requires the Blaze plan. Firebase documents no-cost monthly quotas on Blaze, while billing remains pay-as-you-go; set budget alerts/spend caps in Google Cloud/Firebase Console.
