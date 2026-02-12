#!/usr/bin/env bash
set -euo pipefail

BUCKET="bms.hldesign.io"

# Look up the CloudFront distribution ID for this bucket at runtime
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[0]=='$BUCKET'].Id | [0]" \
  --output text)

if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" = "None" ]; then
  echo "Error: No CloudFront distribution found for $BUCKET"
  exit 1
fi

echo "Building..."
npm run build

echo "Uploading to S3..."
aws s3 sync dist/ "s3://$BUCKET/" --delete

echo "Invalidating CloudFront cache ($DISTRIBUTION_ID)..."
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --output text

echo "Done. Site will update in ~1-2 minutes."
