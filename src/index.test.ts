import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import g1Network, { __reset, destroy, displayAd, init, refresh } from "./index.js";

const VALID_PUB = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UNIT = "550e8400-e29b-41d4-a716-446655440001";

function mockAdResponse(body: unknown, status = 200) {
	return vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
	);
}

beforeEach(() => {
	document.body.innerHTML = '<div id="slot-1" style="width:300px;height:250px"></div>';
});

afterEach(() => {
	__reset();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("init", () => {
	it("rejects non-UUID publisher_id", () => {
		expect(() => init({ publisher_id: "not-uuid" })).toThrow(/UUID/);
	});

	it("accepts valid config", () => {
		expect(() => init({ publisher_id: VALID_PUB })).not.toThrow();
	});

	it("accepts consent block", () => {
		expect(() =>
			init({
				publisher_id: VALID_PUB,
				consent: { tc_string: "CPxxx", gpp_string: "DBABL~...", gpp_sid: [7] },
			}),
		).not.toThrow();
	});
});

describe("displayAd", () => {
	beforeEach(() => init({ publisher_id: VALID_PUB }));

	it("rejects non-UUID ad_unit_id", () => {
		expect(() =>
			displayAd({ ad_unit_id: "not-uuid", container: "#slot-1", sizes: [[300, 250]] }),
		).toThrow(/UUID/);
	});

	it("calls on_error when container не найден", () => {
		const onError = vi.fn();
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#missing",
			sizes: [[300, 250]],
			on_error: onError,
		});
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0]?.[0]?.message).toMatch(/not found/);
	});

	it("calls on_render with imp_id + creative_id on winning bid", async () => {
		const fetchSpy = mockAdResponse({
			ok: true,
			request_id: "req-1",
			bids: [
				{
					bid_id: "bid-srv",
					cpm: 2.5,
					currency: "USD",
					w: 300,
					h: 250,
					creative_id: "creative-42",
					creative_url: "https://adserver.g1.network/serve/creative-42?imp=imp-uuid-1",
					mtype: "banner",
				},
			],
		});
		globalThis.fetch = fetchSpy as never;

		const onRender = vi.fn();
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#slot-1",
			sizes: [[300, 250]],
			on_render: onRender,
			visibility_gated: false,
		});

		// Allow microtask flush
		await new Promise((r) => setTimeout(r, 10));
		expect(onRender).toHaveBeenCalledOnce();
		expect(onRender.mock.calls[0]?.[0]).toEqual({
			imp_id: "imp-uuid-1",
			creative_id: "creative-42",
			w: 300,
			h: 250,
		});
		// Iframe should be rendered.
		const iframe = document.querySelector("#slot-1 iframe");
		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute("data-creative-id")).toBe("creative-42");
	});

	it("calls on_no_bid when SSP returns ok:true но empty bids[]", async () => {
		globalThis.fetch = mockAdResponse({ ok: true, request_id: "x", bids: [] }) as never;
		const onNoBid = vi.fn();
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#slot-1",
			sizes: [[300, 250]],
			on_no_bid: onNoBid,
			visibility_gated: false,
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(onNoBid).toHaveBeenCalledOnce();
	});

	it("calls on_error on HTTP 500", async () => {
		globalThis.fetch = mockAdResponse({ error: "oops" }, 500) as never;
		const onError = vi.fn();
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#slot-1",
			sizes: [[300, 250]],
			on_error: onError,
			visibility_gated: false,
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0]?.[0]?.message).toMatch(/HTTP 500/);
	});

	it("propagates consent (TCF + GPP) в payload", async () => {
		__reset();
		init({
			publisher_id: VALID_PUB,
			consent: { tc_string: "CPxxx.YA", gpp_string: "DBABL~BVQ", gpp_sid: [7] },
		});
		const fetchSpy = mockAdResponse({ ok: true, request_id: "x", bids: [] });
		globalThis.fetch = fetchSpy as never;
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#slot-1",
			sizes: [[300, 250]],
			visibility_gated: false,
		});
		await new Promise((r) => setTimeout(r, 10));
		const [args] = fetchSpy.mock.calls;
		if (!args) throw new Error("missing fetch call");
		// biome-ignore lint/suspicious/noExplicitAny: arg shape от happy-dom Response API
		const bodyJson = JSON.parse((args[1] as any).body);
		expect(bodyJson.tc_string).toBe("CPxxx.YA");
		expect(bodyJson.gpp_string).toBe("DBABL~BVQ");
		expect(bodyJson.gpp_sid).toEqual([7]);
		expect(bodyJson.property_id).toBe(VALID_PUB);
		expect(bodyJson.ad_unit_slug).toBe(VALID_UNIT);
	});
});

describe("destroy", () => {
	beforeEach(() => init({ publisher_id: VALID_PUB }));

	it("clears iframe + removes slot state", async () => {
		globalThis.fetch = mockAdResponse({
			ok: true,
			request_id: "x",
			bids: [
				{
					bid_id: "b",
					cpm: 1,
					currency: "USD",
					w: 300,
					h: 250,
					creative_id: "c",
					creative_url: "https://adserver.g1.network/serve/c?imp=i",
					mtype: "banner",
				},
			],
		}) as never;
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#slot-1",
			sizes: [[300, 250]],
			visibility_gated: false,
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(document.querySelector("#slot-1 iframe")).not.toBeNull();
		destroy("#slot-1");
		expect(document.querySelector("#slot-1 iframe")).toBeNull();
	});

	it("no-op when slot не зарегистрирован", () => {
		expect(() => destroy("#missing")).not.toThrow();
	});
});

describe("refresh", () => {
	beforeEach(() => init({ publisher_id: VALID_PUB }));

	it("triggers new ad-request", async () => {
		const fetchSpy = mockAdResponse({ ok: true, request_id: "x", bids: [] });
		globalThis.fetch = fetchSpy as never;
		displayAd({
			ad_unit_id: VALID_UNIT,
			container: "#slot-1",
			sizes: [[300, 250]],
			visibility_gated: false,
		});
		await new Promise((r) => setTimeout(r, 10));
		const initialCalls = fetchSpy.mock.calls.length;
		refresh("#slot-1");
		await new Promise((r) => setTimeout(r, 10));
		expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCalls);
	});
});

describe("default export shape", () => {
	it("exposes init + displayAd + refresh + destroy", () => {
		expect(typeof g1Network.init).toBe("function");
		expect(typeof g1Network.displayAd).toBe("function");
		expect(typeof g1Network.refresh).toBe("function");
		expect(typeof g1Network.destroy).toBe("function");
	});
});
