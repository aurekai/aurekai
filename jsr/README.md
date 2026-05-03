# @aurekai/sdk

Minimal Aurekai TypeScript surface for Deno, Bun, and Node runtimes.

## Install

```ts
import { AUREKAI_VERSION, artifactUri, isAurekaiManifest } from "jsr:@aurekai/sdk";
```

## API

- `AUREKAI_VERSION`
- `isAurekaiManifest(value)`
- `artifactUri(hash)`
- `featureUri(model, layer, hash)`