# Deployment

The site is served at **https://oscilloscope.gianpa.com** from AWS. It's a static frontend with no backend.

## Infrastructure

Everything is defined in [`infra/frontend.yml`](../infra/frontend.yml): CloudFormation stack
`pocket-scope-frontend`, region `us-east-1` (CloudFront certificates must live there), AWS CLI profile `gianpa`.

| Resource | Details |
|---|---|
| S3 bucket | Private, encrypted (SSE-S3), versioned; old versions are kept 30 days for rollback. HTTPS-only bucket policy, readable only by this CloudFront distribution (Origin Access Control). Kept if the stack is deleted. |
| ACM certificate | For `oscilloscope.gianpa.com`, validated through Route 53 DNS |
| CloudFront | HTTPS only (HTTP redirects), TLS 1.2+, HTTP/2 and 3, IPv6, compression, `PriceClass_100`. Unknown paths serve `index.html` with a 404. |
| Response headers | HSTS (2 years), `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, a same-origin-only CSP, and `Permissions-Policy: microphone=(self), screen-wake-lock=(self), fullscreen=(self), camera=(), geolocation=()` |
| Route 53 | A and AAAA alias records in the `gianpa.com` hosted zone |

The `Permissions-Policy` must keep `microphone=(self)`. Without it the browser blocks the microphone
and the app has no input.

The CSP allows only `'self'`. That covers the bundle, the AudioWorklet module (governed by `script-src`),
the service worker, the manifest and the icons. Anything loaded from another origin would need a CSP change.

### Creating or updating the infrastructure

```sh
aws cloudformation deploy --profile gianpa --region us-east-1 --stack-name pocket-scope-frontend \
  --template-file infra/frontend.yml --parameter-overrides HostedZoneId=Z00924751X5S6M3PU3WB4
```

The first creation takes about 10 minutes, most of it the CloudFront distribution.

## Publishing a new version

```sh
npm run deploy
```

`scripts/deploy.sh` does the following:

1. Reads the bucket, distribution and URL from the stack outputs.
2. Runs `npm run build`.
3. Uploads `dist/assets/*` with `Cache-Control: public, max-age=31536000, immutable`. These files have
   hashed names and never change. Old assets are kept, so a cached `index.html` still finds its bundle.
4. Uploads everything else (`index.html`, `sw.js`, the worklet, manifest and icons) with
   `Cache-Control: no-cache`, deleting files that no longer exist.
5. Invalidates `/`, `/index.html`, `/manifest.webmanifest`, `/sw.js`, `/icon*` and `/worklets/*` on
   CloudFront, and waits for the invalidation to finish.
6. Smoke test: the live page references the new bundle, the bundle and worklet load, and HSTS and the
   microphone `Permissions-Policy` are present.

Installed apps pick up a new version on their next launch while online, because the service worker is
network-first.

### Notes for running it on Windows (Git Bash)

- `MSYS_NO_PATHCONV=1` is set **only** on the `create-invalidation` call. Without it Git Bash rewrites
  `/index.html` into a Windows path. Set globally, it would break `curl -o /dev/null`.
- Smoke-test responses are captured in variables before `grep -q`. `curl | grep -q` fails under
  `pipefail` when grep exits early.
- `curl` retries with `--retry-all-errors`, because a home router can briefly fail to resolve a freshly
  created DNS record.

## Rolling back

The bucket is versioned. Restore the previous versions of `index.html` (and any other changed
non-hashed files) in S3, then invalidate `/index.html` and `/` on the distribution. Old hashed assets
are still in the bucket, so the previous `index.html` works as-is.
