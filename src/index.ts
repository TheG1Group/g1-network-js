/**
 * `@theg1team/g1-network-js` — lightweight ad SDK для non-Prebid publishers.
 *
 * ~10kb gzipped browser SDK. Requests bids от ssp-api.g1.network/ad-request,
 * renders winning ads as SafeFrame 2.0 iframes pointing к
 * adserver.g1.network/serve/<creative_id>?imp=<imp_id>.
 *
 * Vanilla DOM + fetch. No runtime deps. MIT.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ENDPOINT = "https://ssp-api.g1.network/ad-request";
const DEFAULT_REFRESH_S = 30;

export interface InitConfig {
	publisher_id: string;
	consent?: {
		tc_string?: string;
		gpp_string?: string;
		gpp_sid?: number[];
		uid2_token?: string;
	};
	endpoint?: string;
	test_mode?: boolean;
}

export interface DisplayAdConfig {
	ad_unit_id: string;
	container: string | HTMLElement;
	sizes: Array<[number, number]>;
	auto_refresh_s?: number;
	visibility_gated?: boolean;
	on_render?: (info: { imp_id: string; creative_id: string; w: number; h: number }) => void;
	on_no_bid?: () => void;
	on_error?: (err: Error) => void;
}

interface AdResponseBid {
	bid_id: string;
	cpm: number;
	currency: string;
	w: number;
	h: number;
	creative_id: string;
	creative_url: string;
	mtype: string;
}

interface AdResponse {
	ok: boolean;
	request_id: string;
	bids: AdResponseBid[];
}

interface SlotState {
	el: HTMLElement;
	cfg: DisplayAdConfig;
	timer?: ReturnType<typeof setTimeout>;
	observer?: IntersectionObserver;
	visible: boolean;
}

let initConfig: InitConfig | null = null;
const slots = new Map<HTMLElement, SlotState>();

function isValidUuid(s: unknown): s is string {
	return typeof s === "string" && UUID_RE.test(s);
}

function resolveContainer(c: string | HTMLElement): HTMLElement | null {
	if (typeof c === "string") return document.querySelector<HTMLElement>(c);
	return c instanceof HTMLElement ? c : null;
}

export function init(cfg: InitConfig): void {
	if (!isValidUuid(cfg.publisher_id)) {
		throw new Error("g1Network.init: publisher_id must be UUID v4");
	}
	initConfig = cfg;
}

/** Internal: build payload for ad-request endpoint. */
function buildPayload(cfg: DisplayAdConfig): unknown {
	if (!initConfig) throw new Error("g1Network not initialized — call init() first");
	const c = initConfig.consent ?? {};
	return {
		property_id: initConfig.publisher_id,
		ad_unit_slug: cfg.ad_unit_id,
		page_url: typeof location !== "undefined" ? location.href : "",
		page_ref: typeof document !== "undefined" ? document.referrer || undefined : undefined,
		tc_string: c.tc_string,
		gpp_string: c.gpp_string,
		gpp_sid: c.gpp_sid,
		uid2_token: c.uid2_token,
		test_mode: initConfig.test_mode,
		sizes: cfg.sizes,
	};
}

/** Internal: clear any existing iframe content in slot. */
function clearSlot(el: HTMLElement): void {
	el.innerHTML = "";
}

/** Internal: render iframe для winning bid. */
function renderBid(el: HTMLElement, bid: AdResponseBid): void {
	clearSlot(el);
	const iframe = document.createElement("iframe");
	iframe.src = bid.creative_url;
	iframe.width = String(bid.w);
	iframe.height = String(bid.h);
	iframe.frameBorder = "0";
	iframe.scrolling = "no";
	iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
	iframe.setAttribute("data-creative-id", bid.creative_id);
	el.appendChild(iframe);
}

async function fetchBid(cfg: DisplayAdConfig): Promise<AdResponseBid | null> {
	if (!initConfig) return null;
	const endpoint = initConfig.endpoint ?? DEFAULT_ENDPOINT;
	const res = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(buildPayload(cfg)),
		credentials: "omit",
	});
	if (!res.ok) throw new Error(`ad-request HTTP ${res.status}`);
	const body = (await res.json()) as AdResponse;
	if (!body.ok || !body.bids || body.bids.length === 0) return null;
	return body.bids[0] ?? null;
}

/** Internal: ensure slot is in viewport (visibility-gated refresh). */
function isVisible(state: SlotState): boolean {
	if (!state.cfg.visibility_gated) return true;
	return state.visible;
}

async function loadSlot(state: SlotState): Promise<void> {
	try {
		const bid = await fetchBid(state.cfg);
		if (!bid) {
			state.cfg.on_no_bid?.();
			return;
		}
		// Extract imp_id from creative_url's query param if present (best-effort).
		const u = (() => {
			try {
				return new URL(bid.creative_url);
			} catch {
				return null;
			}
		})();
		const impId = u?.searchParams.get("imp") ?? bid.bid_id;
		renderBid(state.el, bid);
		state.cfg.on_render?.({
			imp_id: impId,
			creative_id: bid.creative_id,
			w: bid.w,
			h: bid.h,
		});
	} catch (err) {
		state.cfg.on_error?.(err instanceof Error ? err : new Error(String(err)));
	}
}

function scheduleRefresh(state: SlotState): void {
	if (state.timer) clearTimeout(state.timer);
	const period = (state.cfg.auto_refresh_s ?? DEFAULT_REFRESH_S) * 1000;
	if (period <= 0) return;
	state.timer = setTimeout(async () => {
		if (isVisible(state)) {
			await loadSlot(state);
		}
		scheduleRefresh(state);
	}, period);
}

export function displayAd(cfg: DisplayAdConfig): void {
	if (!initConfig) throw new Error("g1Network not initialized — call init() first");
	if (!isValidUuid(cfg.ad_unit_id)) {
		throw new Error("displayAd: ad_unit_id must be UUID v4");
	}
	const el = resolveContainer(cfg.container);
	if (!el) {
		cfg.on_error?.(new Error("displayAd: container element not found"));
		return;
	}
	// Destroy any prior slot at this element.
	const prior = slots.get(el);
	if (prior) {
		if (prior.timer) clearTimeout(prior.timer);
		prior.observer?.disconnect();
		clearSlot(el);
	}

	const state: SlotState = {
		el,
		cfg: { auto_refresh_s: DEFAULT_REFRESH_S, visibility_gated: true, ...cfg },
		visible: true,
	};

	// Wire IntersectionObserver когда visibility_gated.
	if (state.cfg.visibility_gated && typeof IntersectionObserver !== "undefined") {
		state.observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) state.visible = e.isIntersecting;
			},
			{ threshold: 0.5 },
		);
		state.observer.observe(el);
	}

	slots.set(el, state);
	void loadSlot(state).then(() => scheduleRefresh(state));
}

export function refresh(container: string | HTMLElement): void {
	const el = resolveContainer(container);
	if (!el) return;
	const state = slots.get(el);
	if (!state) return;
	void loadSlot(state);
}

export function destroy(container: string | HTMLElement): void {
	const el = resolveContainer(container);
	if (!el) return;
	const state = slots.get(el);
	if (!state) return;
	if (state.timer) clearTimeout(state.timer);
	state.observer?.disconnect();
	clearSlot(el);
	slots.delete(el);
}

/** Test-only: reset module state. Not part of public API. */
export function __reset(): void {
	for (const state of slots.values()) {
		if (state.timer) clearTimeout(state.timer);
		state.observer?.disconnect();
	}
	slots.clear();
	initConfig = null;
}

const g1Network = { init, displayAd, refresh, destroy };
export default g1Network;
