# Aurekai-owned deployment configuration

[tenant-hosts.tsv](tenant-hosts.tsv) is the approved **source configuration** for Aurekai's four website territories. It is not an active deployment receipt.

A deployed Bonfÿre engine can consume an authorized copy through the BONFYRE_TENANT_HOSTS_FILE configuration path. [Bonfÿre's native C tenant-host checker](https://github.com/Nickgonzales76017/bonfyre/blob/main/cmd/BonfyreWebAddress/tools/check_tenant_hosts.c) validates the row format, exact hosts and refusal on malformed or ambiguous mappings.

[nginx/aurekai-surfaces.conf](nginx/aurekai-surfaces.conf) is a **byte-identical historical Aurekai-specific carrier configuration**, moved from the Bonfÿre source to this operator destination. Its certificate paths and institution/client host gates are environment-specific: it is not safe to blindly enable on a new machine. Client and account routing require authentication and exact authority independent of TLS and domain matching.

The rollout must preserve the active four-domain release until an operator-owned installation has passed source/CMS revision, real account and SSO, host/certificate, browser layout and four-apex readback. No credentials belong in git.

[Migration ledger](../docs/business-source-migration.tsv) · [Site files](../sites/README.md) · [Ownership](../OWNERSHIP.md)
