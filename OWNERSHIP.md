# Aurekai business ownership / Bonfÿre software boundary

**Separate principals:** Aurekai is a business and one software operator. Bonfÿre is a reusable native software engine, not Aurekai's former name, subsidiary permission namespace or inherited provider account.

| Concern | Aurekai owns or controls | Bonfÿre retains |
| --- | --- | --- |
| Identity | Business, brands, client relationships and operator products | Independently named developer platform and technical versions |
| Frontends | Site-specific layouts, colors, copy, audiences, selected user experience and public destinations | Generic Puck/GrapesJS/Editor.js integrations, typed native composition, MD4C/C rendering, PCSS/Tailwind primitives |
| Data | Business CMS entries, publications, source-qualified work, contractually authorized client/creator state | Generic SQLite/Arrow/Parquet/Vec/vGPU processing and interoperable data readers |
| Credentials | Sealed, destination-scoped installations in the actual account | Credential-envelope format and exact scope enforcement; no implicit access to a tenant |
| Software release | Selected installed Bonfÿre version and Aurekai release/rollout approval | Engine revision, ABI, commands, tests and source-proven technical release |
| Commerce | Offers, verified proposals, client approvals and actual financial effects | Generic finance and work contracts, no assumed Aurekai revenue |
| Customer rights | Each named customer or creator owns their actual state under the applicable agreement | No inherited ownership or data access from software deployment |

This company repository hosts Aurekai's own content, commercial and deployment configuration. Bonfÿre's technical source stays in [the Bonfÿre repository](https://github.com/Nickgonzales76017/bonfyre). A customer may operate Bonfÿre without becoming an Aurekai customer, and using Aurekai's services does not automatically make customer records assets of the engine.

**Release boundary:** [deploy/tenant-hosts.tsv](deploy/tenant-hosts.tsv) is configuration source, not live acceptance. Each deployment selects a version, owner, current credentials/grants, release record, and exact host/audience. No guessed domain suffix can grant site publication or cross-customer access.

**Source move:** [docs/business-source-migration.tsv](docs/business-source-migration.tsv) records byte-identical Aurekai-owned business/presentation copies from the Bonfÿre tree. The old source remains until all readers and deployment paths are reconciled and acceptance passes. Historical Akai runtime artifacts remain for explicitly versioned compatibility, not as canonical business identity.

[Independent Bonfÿre boundary](https://github.com/Nickgonzales76017/bonfyre/blob/main/docs/OWNERSHIP-BOUNDARY.md) · [Cutover procedure](MIGRATION.md)
