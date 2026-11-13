# Aurekai

**The operating business behind software-powered brands, publications, communities, services and client work.**

Every brand is built on software. The ones everyone talks about are built on Aurekai.

Aurekai is an **independent operating business**. Its products, public destinations, customer relationships, offers, creators, editorial, brand identity, and account-specific deployments do not belong to a software engine merely because Aurekai uses it.

## Four public destinations

| Destination | What Aurekai operates |
| --- | --- |
| [aurekai.work](https://aurekai.work) | Business, clients, opportunities, software products, workspaces and delivery |
| [aurekai.live](https://aurekai.live) | Creators, media, publishing, shows, listening and community experiences |
| [aurekai.shop](https://aurekai.shop) | Offers, catalogues, commerce and fulfillment |
| [aurekai.life](https://aurekai.life) | People, personal worlds, collections and communities |

These are Aurekai-specific destinations; **they are not Bonfÿre engine defaults**. A repository record is not evidence that its content is already published or its application is live.

## Bonfÿre is separate software

[Bonfÿre](https://github.com/Nickgonzales76017/bonfyre) is the independently maintained **native engine and developer technology**. Its C/Zig runtime, CUE/YAFF contracts, generic site and authoring compilers, MCP and native connectors, storage, vGPU compute, Embed/Vec, FPQ/BitNet and technical tests belong to its own engine source and release process.

Aurekai can install and configure Bonfÿre. Other organizations can too. **No engine installation automatically transfers the business, customer data, brand, revenue, provider credentials or publication rights.** Conversely, Aurekai does not automatically own other users or engine releases.

[Ownership boundaries](OWNERSHIP.md) · [Deployment](deploy/README.md) · [Site material](sites/README.md) · [Business source](business/README.md)

## Business-owned source in this repository

- [Aurekai four-domain host binding](deploy/tenant-hosts.tsv): explicit WORK/LIFE/LIVE/SHOP hosts and account entrypoints.
- [Historical nginx transport carrier](deploy/nginx/aurekai-surfaces.conf): migrated deployment-specific source; **not automatically deployed**.
- [Published front-door copy](sites/content/territory-presentations.jsonl), [editorial house tokens](sites/content/territory-houses.json), [route presentation designs](sites/presentation/route-presentation.jsonl), and [Stitch variants](sites/presentation/presentation-template-stitch.jsonl).
- [Acquisition partner/source qualification](business/acquisition/acquisition-networks-qualification-20261106.tsv) and [finished-work briefs](business/work-samples/), with separate commercial/provenance gates.
- [Exact source migration ledger](docs/business-source-migration.tsv): original Bonfÿre file path and Git blob SHA for each migrated asset.

Original source files are retained in the Bonfÿre repository until the site/CMS consumers have been switched, tests and live readback have passed, and their old roles are deliberately retired. **Copying source is not an activated deployment, CMS import, contract or sale.**

## Historic Akai packages remain, without redefining the business

This repository has an earlier runtime lineage: npm **@aurekai/runtime**, the **akai** CLI, **bonfyre** command aliases, and legacy Python, IDE, MCP and native adapters. These are existing distributed interfaces and must not be deleted or renamed in bulk. They remain for compatibility and gradual versioned migration; they do **not** make Aurekai and Bonfÿre synonyms.

[Legacy compatibility](COMPATIBILITY.md) · [Current migration rules](MIGRATION.md) · [Prior runtime-centric README, preserved](docs/archive/README-runtime-20261113.md) · [Technical release history](docs/releases.md)

## Actual delivery criteria

An **engine build** is not an **Aurekai launch**. A **site seed** is not a **published page**. A **provider candidate** is not an **authorized connection**. A **proposal** is not **revenue**.

Each requires an exact destination-owned contract, current grant, CMS revision, site release and public/account readback. Credentials and private client records remain in their proper sealed and account-owned systems, never in this public source repository.
