#!/usr/bin/env bash
# One-time cloud hardening from the 2026-09-19 security review. Idempotent —
# safe to re-run. Run from the repo root:  bash scripts/security-hardening.sh
#
#   1. Secrets move from plain function env vars into Secret Manager.
#   2. Functions stop running as the default compute account (project Editor):
#      admin-config / og-image get their own minimal accounts, the Earth Engine
#      functions share the existing EE-only account.
#   3. Every function is capped at 5 instances (cost / quota abuse, and it
#      throttles password guessing against admin-config).
#   4. The bucket stays publicly readable but is no longer publicly listable.
#   5. The browser Maps key loses two APIs it never uses.
set -euo pipefail

export CLOUDSDK_PYTHON=${CLOUDSDK_PYTHON:-/opt/homebrew/bin/python3.13}
export PATH=$PATH:/opt/homebrew/share/google-cloud-sdk/bin
P=salish-sea-property-mapper
R=us-west1
BUCKET=gs://salish-ndvi-tiles
EE_SA=ee-tile-server@$P.iam.gserviceaccount.com
ADMIN_SA=admin-config-fn@$P.iam.gserviceaccount.com
OG_SA=og-image-fn@$P.iam.gserviceaccount.com
MAX=5

echo "== 1. Secret Manager"
gcloud services enable secretmanager.googleapis.com --project $P

# Copies a live env value into a secret without ever printing it. Skipped when
# the secret already exists (or the env var is already gone on a re-run).
to_secret() { # <function> <ENV_NAME> <secret-name>
  if gcloud secrets describe "$3" --project $P >/dev/null 2>&1; then
    echo "   $3 already exists"; return
  fi
  gcloud functions describe "$1" --region $R --project $P --format=json \
    | python3 -c "import json,sys; sys.stdout.write(json.load(sys.stdin)['serviceConfig']['environmentVariables']['$2'])" \
    | gcloud secrets create "$3" --project $P --replication-policy automatic --data-file=-
}
to_secret admin-config ADMIN_PASSWORD admin-password
to_secret og-image OG_SIGNING_SECRET og-signing-secret
to_secret og-image GOOGLE_STATIC_MAPS_KEY static-maps-key

echo "== 2. Service accounts"
for sa in admin-config-fn og-image-fn; do
  gcloud iam service-accounts describe $sa@$P.iam.gserviceaccount.com --project $P >/dev/null 2>&1 \
    || gcloud iam service-accounts create $sa --project $P --display-name "$sa (least privilege)"
done
sleep 10  # new accounts take a moment to be usable in IAM bindings

grant_secret() { gcloud secrets add-iam-policy-binding "$1" --project $P \
  --member "serviceAccount:$2" --role roles/secretmanager.secretAccessor >/dev/null; }
grant_secret admin-password "$ADMIN_SA"
grant_secret og-signing-secret "$OG_SA"
grant_secret static-maps-key "$OG_SA"
# admin-config writes config/*.json and calls make_public() on them. The bucket
# uses fine-grained ACLs, so IAM conditions aren't available — bucket-level
# objectAdmin is the narrowest grant that works.
gsutil iam ch "serviceAccount:$ADMIN_SA:roles/storage.objectAdmin" $BUCKET

echo "== 3. Redeploy functions"
common="--gen2 --region $R --project $P --trigger-http --allow-unauthenticated --max-instances $MAX --quiet"

gcloud functions deploy admin-config $common --source cloud-functions/admin-config \
  --runtime python311 --entry-point admin_config --memory 256Mi --timeout 60 \
  --service-account "$ADMIN_SA" \
  --remove-env-vars ADMIN_PASSWORD \
  --set-secrets ADMIN_PASSWORD=admin-password:latest

gcloud functions deploy og-image $common --source cloud-functions/og-image \
  --runtime python311 --entry-point og_image --memory 512Mi --timeout 60 \
  --service-account "$OG_SA" \
  --remove-env-vars OG_SIGNING_SECRET,GOOGLE_STATIC_MAPS_KEY \
  --set-secrets OG_SIGNING_SECRET=og-signing-secret:latest,GOOGLE_STATIC_MAPS_KEY=static-maps-key:latest

gcloud functions deploy ee-ndvi-tiles $common --source cloud-functions/ee-tiles \
  --runtime python312 --entry-point get_tiles --memory 512Mi --timeout 120 \
  --service-account "$EE_SA"
gcloud functions deploy hansen-forest-change $common --source cloud-functions/hansen-forest-change \
  --runtime python311 --entry-point get_tiles --memory 512Mi --timeout 60 \
  --service-account "$EE_SA"
gcloud functions deploy opera-dist-alert $common --source cloud-functions/opera-dist-alert \
  --runtime python311 --entry-point get_tiles --memory 256Mi --timeout 60 \
  --service-account "$EE_SA"

echo "== 4. Bucket: public read, no public listing"
gsutil iam ch allUsers:roles/storage.legacyObjectReader $BUCKET
gsutil iam ch -d allUsers:roles/storage.objectViewer $BUCKET

echo "== 5. Browser Maps key: drop unused APIs"
KEY=$(gcloud services api-keys list --project $P \
  --filter='displayName="Salish Sea Explorer API Key"' --format='value(name)')
gcloud services api-keys update "$KEY" \
  --allowed-referrers='salishsea.knauernever.com/*,localhost:*/*,http://localhost:5173/*' \
  --api-target=service=maps-backend.googleapis.com \
  --api-target=service=places.googleapis.com \
  --api-target=service=geocoding-backend.googleapis.com

echo "== Smoke tests"
S=https://salishsea.knauernever.com
CF=https://$R-$P.cloudfunctions.net
t() { # <label> <expected> <url> [post]
  local extra=()
  [ -n "${4:-}" ] && extra=(-X POST -H 'X-Admin-Token: wrong')
  printf '   %-32s want %s got %s\n' "$1" "$2" "$(curl -s -o /dev/null -w '%{http_code}' ${extra[@]+"${extra[@]}"} "$3")"
}
t "admin GET"                     200 "$S/api/admin/categories"
t "admin wrong password"          401 "$S/api/admin/categories?verify=1" post
t "og default image"              200 "$S/api/og"
t "og unsigned params"            403 "$S/api/og?c=48.5,-123"
t "ndvi valid season"             200 "$CF/ee-ndvi-tiles?start=2024-06-01&end=2024-08-31"
t "ndvi bad dates"                400 "$CF/ee-ndvi-tiles?start=x&end=y"
t "hansen tiles"                  200 "$CF/hansen-forest-change"
t "hansen point outside county"   400 "$CF/hansen-forest-change?lat=0&lng=0"
t "opera tiles"                   200 "$CF/opera-dist-alert"
t "bucket object readable"        200 "https://storage.googleapis.com/salish-ndvi-tiles/config/category-tree.json"
t "bucket listing denied"         401 "https://storage.googleapis.com/storage/v1/b/salish-ndvi-tiles/o?maxResults=1"
echo "Then sign in at $S/admin and save once to confirm writes still work."
