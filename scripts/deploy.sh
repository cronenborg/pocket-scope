#!/usr/bin/env bash
# Builds the site and publishes it to the pocket-scope-frontend stack
# (personal AWS account, profile "gianpa"). Infrastructure: infra/frontend.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-gianpa}"
REGION=us-east-1
STACK=pocket-scope-frontend

out() {
  aws cloudformation describe-stacks --profile "$PROFILE" --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
BUCKET=$(out BucketName)
DISTRIBUTION=$(out DistributionId)
SITE_URL=$(out SiteUrl)

npm run build

# Hashed files never change: cache for a year. Old ones are kept so visitors
# with a cached index.html still find what it references.
aws s3 sync dist/assets "s3://$BUCKET/assets" --profile "$PROFILE" \
  --cache-control "public, max-age=31536000, immutable" --only-show-errors
# Everything else (index.html, worklet, manifest, icon) is revalidated on every visit.
aws s3 sync dist "s3://$BUCKET" --profile "$PROFILE" --exclude "assets/*" --delete \
  --cache-control "no-cache" --only-show-errors

# MSYS_NO_PATHCONV: Git Bash on Windows would rewrite "/index.html" into a Windows path.
id=$(MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --profile "$PROFILE" --distribution-id "$DISTRIBUTION" \
  --paths "/" "/index.html" "/manifest.webmanifest" "/sw.js" "/icon*" "/worklets/*" \
  --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --profile "$PROFILE" --distribution-id "$DISTRIBUTION" --id "$id"

# Smoke test: the live page serves this build, its bundle and worklet, and the security headers.
entry=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)
echo "expecting $entry at $SITE_URL"
# Retries ride out a home router that briefly fails to resolve a freshly created record.
get() { curl -fsS --retry 5 --retry-delay 3 --retry-all-errors "$@"; }
# (Fetched into variables first: `curl | grep -q` fails under pipefail when grep exits early.)
page=$(get "$SITE_URL/")
grep -q "$entry" <<<"$page"
get -o /dev/null "$SITE_URL/$entry"
get -o /dev/null "$SITE_URL/worklets/capture.js"
headers=$(get -I "$SITE_URL/")
grep -qi "strict-transport-security" <<<"$headers"
grep -qi "permissions-policy:.*microphone=(self)" <<<"$headers"
echo "deployed: $SITE_URL"
