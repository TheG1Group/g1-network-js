# @theg1team/g1-network-js

Lightweight (~10kb gzipped) ad SDK для **non-Prebid publishers**. OSS MIT. Phase 6 deliverable per FINAL-PLAN.md.

Use this when you don't want a full Prebid wrapper — drop-in SDK requests bids from g1.network SSP и renders winning ads as SafeFrame 2.0 iframes.

If you already run Prebid.js: use [`@theg1team/prebid-adapter`](https://www.npmjs.com/package/@theg1team/prebid-adapter) instead.

## Install

```bash
npm install @theg1team/g1-network-js
# or via CDN (auto-mirrored to jsDelivr/unpkg from oss.g1.network):
# <script src="https://cdn.jsdelivr.net/npm/@theg1team/g1-network-js@latest/dist/index.global.js"></script>
# <script src="https://unpkg.com/@theg1team/g1-network-js@latest/dist/index.global.js"></script>
```

## Usage (ES module)

```javascript
import g1Network from "@theg1team/g1-network-js";

g1Network.init({
	publisher_id: "550e8400-e29b-41d4-a716-446655440000",
	consent: {
		tc_string: "CPxxx.YAAAAAAAAA",  // TCF v2.2
		gpp_string: "DBABL~BVQqAAAAAgA.QA",  // GPP USNAT (optional)
		gpp_sid: [7],
	},
});

g1Network.displayAd({
	ad_unit_id: "550e8400-e29b-41d4-a716-446655440001",
	container: "#ad-slot-1",
	sizes: [[300, 250]],
	auto_refresh_s: 30,  // optional (defaults к 30s per FINAL-PLAN §3 Phase 3)
	on_render: (info) => console.log("ad rendered", info),
	on_no_bid: () => console.log("no bid"),
});

// Manual refresh
g1Network.refresh("#ad-slot-1");

// Cleanup (stops auto-refresh, removes iframe)
g1Network.destroy("#ad-slot-1");
```

## Usage (CDN / global)

```html
<script src="https://cdn.jsdelivr.net/npm/@theg1team/g1-network-js@latest/dist/index.global.js"></script>
<div id="ad-slot-1"></div>
<script>
	g1Network.init({ publisher_id: "..." });
	g1Network.displayAd({ ad_unit_id: "...", container: "#ad-slot-1", sizes: [[300, 250]] });
</script>
```

## What it does

1. POST `https://ssp-api.g1.network/ad-request` с UUID publisher_id + ad_unit_id, page URL, TCF/GPP consent.
2. On winning bid: render `<iframe src="adserver.g1.network/serve/<creative_id>?imp=<imp_id>">` into the container.
3. Auto-refresh every 30s (configurable; per FINAL-PLAN §3 Phase 3 auto_refresh_s).
4. Optional viewability-gated refresh (browser IntersectionObserver) — refresh skipped when slot not в viewport.

## Compliance

- TCF v2.2 + GPP USNAT respected (TC + GPP strings propagated в BidRequest).
- ads.txt declares `g1.network, <publisher_id>, DIRECT`.
- sellers.json entry для each registered publisher via `ssp-api.g1.network/sellers.json`.
- SafeFrame 2.0 isolation — ads run в sandboxed iframes.

## Bundle size

```
$ pnpm size
# Target: <10kb gzipped (ES2020 minified)
```

## License

MIT — see [LICENSE](LICENSE).

## Version policy

SemVer + 12mo deprecation для breaking changes (FINAL-PLAN §5 SDK versioning policy).
