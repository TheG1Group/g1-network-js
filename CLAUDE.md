# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Project context:** part of g1.network ad-tech build per `g1-adtech-plan/FINAL-PLAN.md`. **Phase 6** deliverable: OSS MIT npm package для non-Prebid publishers. ~10kb gzipped budget.

## Project Overview

Single npm package — no monorepo. Browser-target SDK. Ships ESM + CJS + IIFE (global `g1Network`) + .d.ts.

## Architecture

- **Source**: `src/index.ts` exports `g1Network` (object with init/displayAd/refresh/destroy methods) + default export.
- **Types**: inline (small package; no separate types.ts).
- **Build**: tsup → 3 formats:
  - `dist/index.js` (ESM)
  - `dist/index.cjs` (CJS)
  - `dist/index.global.js` (IIFE, global `g1Network`)
  - `dist/index.d.ts` (+ `.d.cts` mirror)
- **Test**: vitest + happy-dom (DOM stubs needed для container resolution + iframe creation).
- **Endpoint**: POST `https://ssp-api.g1.network/ad-request` → render iframe pointing к `https://adserver.g1.network/serve/<creative_id>?imp=<imp_id>`.

## Public API

```ts
interface InitConfig {
	publisher_id: string;  // UUID
	consent?: { tc_string?: string; gpp_string?: string; gpp_sid?: number[]; uid2_token?: string };
	endpoint?: string;  // override для testing
	test_mode?: boolean;
}

interface DisplayAdConfig {
	ad_unit_id: string;  // UUID
	container: string | HTMLElement;  // CSS selector or element
	sizes: Array<[number, number]>;  // IAB sizes
	auto_refresh_s?: number;  // default 30
	visibility_gated?: boolean;  // default true; require slot в viewport для refresh
	on_render?: (info: { imp_id: string; creative_id: string }) => void;
	on_no_bid?: () => void;
	on_error?: (err: Error) => void;
}

g1Network.init(config: InitConfig): void;
g1Network.displayAd(config: DisplayAdConfig): void;
g1Network.refresh(container: string | HTMLElement): void;
g1Network.destroy(container: string | HTMLElement): void;
```

## Engineering standards (FINAL-PLAN §2 + §22a OSS)

- **MIT license** (OSS).
- **No `@theg1team/*` internal deps** — external publishers consume directly.
- **Browser-only**: ES2020, `lib: ["ES2020", "DOM"]`. No Node-only APIs.
- **Bundle size ≤10kb gzipped** (FINAL-PLAN §3 Phase 6). Minified ES2020 IIFE.
- **No external runtime deps** — vanilla DOM + fetch.
- **TypeScript strict**.
- **SemVer + 12mo deprecation** для breaking changes.
- **Visibility-gated refresh** через `IntersectionObserver` (avoid auto-refresh fraud per FINAL-PLAN §8 risk register).

## Don't

- Don't add runtime deps — every byte counts (10kb budget).
- Don't depend на `@theg1team/*` workspace packages — keep self-contained для external publishers.
- Don't ship без TCF v2.2 + GPP support (regulatory hard requirement).
- Don't fetch без `credentials: 'omit'` — we don't want third-party cookies in flight.
- Don't trust `container` query — always validate element exists, fall through к on_error otherwise.

## Publish flow

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
2. `pnpm size` — verify ≤10kb gzipped.
3. `pnpm version <patch|minor|major>`.
4. `git push --tags` → GitHub Actions release runs `pnpm publish` к npmjs.org.
5. jsDelivr + unpkg auto-mirror within 1-5 min.

## Verification

Before commit: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
