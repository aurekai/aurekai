# Aurekai-owned deployment configuration

[tenant-hosts.tsv](tenant-hosts.tsv) is the approved **source configuration** for Aurekai's four website territories. It is not an active deployment receipt.

A deployed Bonfÿre engine can consume an authorized copy through the BONFYRE_TENANT_HOSTS_FILE configuration path. [Bonfÿre's native C tenant-host checker](https://github.com/Nickgonzales76017/bonfyre/blob/main/cmd/BonfyreWebAddress/tools/check_tenant_hosts.c) validates the row format, exact hosts and refusal on malformed or ambiguous mappings.

[nginx/aurekai-surfaces.conf](nginx/aurekai-surfaces.conf) is a **byte-identical historical Aurekai-specific carrier configuration**, moved from the Bonfÿre source to this operator destination. Its certificate paths and institution/client host gates are environment-specific: it is not safe to blindly enable on a new machine. Client and account routing require authentication and exact authority independent of TLS and domain matching.

The rollout must preserve the active four-domain release until an operator-owned installation has passed source/CMS revision, real account and SSO, host/certificate, browser layout and four-apex readback. No credentials belong in git.

[Migration ledger](../docs/business-source-migration.tsv) · [Site files](../sites/README.md) · [Ownership](../OWNERSHIP.md)

## Source-bound CMS imports

[install-owned-cms-content.sh](install-owned-cms-content.sh) explicitly selects the business-owned source files when invoking the corresponding *generic Bonfÿre* CMS importer. It never automatically imports because a repo was cloned or an engine was installed.

Read-only preflight, no CMS needed:

~~~sh
sh deploy/install-owned-cms-content.sh check houses
sh deploy/install-owned-cms-content.sh check front-doors
sh deploy/install-owned-cms-content.sh check route-presentations
sh deploy/install-owned-cms-content.sh check stitch-template
sh deploy/install-owned-cms-content.sh check work-examples
~~~

Actual writes require **apply** instead of **check**, an existing BONFYRE_CMS_DB, an executable BONFYRE_CMS_BINARY, and the matching verified engine importer. Authored front doors and route/Stitch imports additionally require the exact BONFYRE_CMS_NAMESPACE. Direct route/Stitch imports require BONFYRE_CMS_SCHEMAS; houses require BONFYRE_HOUSES_INSTALLER; fronts require BONFYRE_AUTHORED_ROWS_INSTALLER; work examples require BONFYRE_WORK_EXAMPLES_INSTALLER. This separation preserves the release owner's responsibility for publication and data rights.

[CI verifies all five bindings without touching a real account database](../deploy/tests/owned-cms-content-test.sh). **No production CMS write or release activation was performed by moving the source.**
