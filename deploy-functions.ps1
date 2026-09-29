# Run from the warehouse_orders repository root after applying the upgrade.
npm install -g firebase-tools
firebase login
firebase deploy --only functions

Write-Host ""
Write-Host "Deployment finished. Open the site on each PC/phone and enable notifications once."
