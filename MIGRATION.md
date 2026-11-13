# Aurekai / Bonfÿre separation — source, deployment and package compatibility

The earlier instructions to rename every "Bonfyre" occurrence to "Akai" are **superseded**. Global source/ABI replacement would break distinct engines, runtime interfaces, published package users and customer deployments. The exact prior document is [archived](docs/archive/MIGRATION-runtime-20261113.md) for history.

## Already done: ownership and content source migration

- Aurekai owns [deploy/tenant-hosts.tsv](deploy/tenant-hosts.tsv) and the copied [historical nginx carrier](deploy/nginx/aurekai-surfaces.conf).
- Aurekai owns copied site front-door records, house tokens, route presentations, Stitch choices, acquisition qualification and work-sample definitions.
- [Source ledger](docs/business-source-migration.tsv) preserves original Bonfÿre paths and exact blob identity.
- Bonfÿre has a tenant-host reader and SSO/presentation/profile isolation tests. **No source copy or engine test is a live-site cutover.**

## Next: real installation and release

1. Verify the ledger and schema sources using the included business boundary checker.
2. Verify the approved destination-specific Bonfÿre binary reads the Aurekai tenant host file. A raw hostname is not sufficient authority.
3. Move CMS/source import consumers to exact Aurekai-owned revisions without losing original source and publication history.
4. Validate public WORK/LIVE/SHOP/LIFE fronts, authenticated account hosts, design tokens, articles, profile owners, and actual user actions against the chosen release.
5. Only after acceptance retire obsolete Bonfÿre-hosted Aurekai source into explicit history or compatibility tests; preserve rollback and existing active domains.

## Keep legacy runtime compatibility separate

The npm @aurekai/runtime package, akai CLI, older Bonfyre aliases, formats, manifests, extension packages and native-runtime lineage have shipped historically. Do not remove or globally rewrite them. Any runtime-package ownership move needs its own revisioned distribution, ABI/readback and downstream user test.

**No live changes:** This GitHub source migration does not change DNS, Cloudflare, nginx, secrets, existing active binaries, or account rights. [Current ownership agreement](OWNERSHIP.md) · [Deployment](deploy/README.md) · [Historical compatibility](COMPATIBILITY.md)
