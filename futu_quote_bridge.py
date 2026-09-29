"""Local adapter for Futu OpenD market snapshots.

Install with: python -m pip install futu-api
Then start Futu OpenD and log in before running this file.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_DEPENDENCIES = os.path.join(ROOT, ".futu-sdk")
if os.path.isdir(LOCAL_DEPENDENCIES):
    sys.path.insert(0, LOCAL_DEPENDENCIES)
os.environ["APPDATA"] = os.path.join(ROOT, ".futu-runtime")

try:
    from futu import Market, OpenQuoteContext, RET_OK, SecurityType
except ImportError as error:
    raise SystemExit("Missing dependency: install it with `python -m pip install futu-api`.") from error

OPEND_HOST = "127.0.0.1"
OPEND_PORT = 11111
BRIDGE_PORT = 6188


def snapshot(codes):
    quote_ctx = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
    try:
        ret, data = quote_ctx.get_market_snapshot(codes)
        if ret != RET_OK:
            raise RuntimeError(str(data))
        return [
            {
                "code": str(row.get("code", "")),
                "name": str(row.get("name", "")),
                "lastPrice": number_or_none(row.get("last_price")),
                "previousClose": number_or_none(row.get("prev_close_price")),
                "changeRate": number_or_none(row.get("change_rate")),
                "openPrice": number_or_none(row.get("open_price")),
                "highPrice": number_or_none(row.get("high_price")),
                "lowPrice": number_or_none(row.get("low_price")),
                "volume": number_or_none(row.get("volume")),
                "turnover": number_or_none(row.get("turnover")),
                "turnoverRate": number_or_none(row.get("turnover_rate")),
                "amplitude": number_or_none(row.get("amplitude")),
                "dataDate": str(row.get("data_date", "")),
                "dataTime": str(row.get("data_time", "")),
                "suspended": bool(row.get("suspension", False)),
            }
            for _, row in data.iterrows()
        ]
    finally:
        quote_ctx.close()


MARKETS = {"hk": (Market.HK,), "us": (Market.US,)}


def search_securities(market, query):
    normalized = query.strip().lower()
    variants = {normalized}
    if market == "hk" and normalized.isdigit():
        variants.add(normalized.zfill(5))
    quote_ctx = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
    try:
        results = []
        for futu_market in MARKETS[market]:
            ret, data = quote_ctx.get_stock_basicinfo(futu_market, SecurityType.STOCK)
            if ret != RET_OK:
                raise RuntimeError(str(data))
            for _, row in data.iterrows():
                code = str(row.get("code", ""))
                name = str(row.get("name", ""))
                if any(term in code.lower() or term in name.lower() for term in variants):
                    results.append({
                        "code": code.split(".", 1)[-1],
                        "futuCode": code,
                        "name": name,
                        "exchange": code.split(".", 1)[0],
                        "market": market,
                        "source": "Futu OpenAPI",
                    })
                    if len(results) >= 12:
                        return results
        return results
    finally:
        quote_ctx.close()


def number_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        request = urlparse(self.path)
        if request.path not in ("/market-snapshot", "/securities/search"):
            self.respond(404, {"message": "Not found"})
            return
        if request.path == "/securities/search":
            params = parse_qs(request.query)
            market = params.get("market", [""])[0]
            query = params.get("q", [""])[0].strip()
            if market not in MARKETS or not query:
                self.respond(400, {"message": "Provide a supported market and stock name or code."})
                return
            try:
                self.respond(200, {"results": search_securities(market, query)})
            except Exception as error:
                self.respond(502, {"message": f"Futu OpenD search request failed: {error}"})
            return
        codes = [code.strip().upper() for code in parse_qs(request.query).get("codes", [""])[0].split(",") if code.strip()]
        if not codes or len(codes) > 200:
            self.respond(400, {"message": "Provide 1 to 200 comma-separated Futu codes."})
            return
        try:
            self.respond(200, {"snapshots": snapshot(codes)})
        except Exception as error:
            self.respond(502, {"message": f"Futu OpenD quote request failed: {error}"})

    def respond(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        return


if __name__ == "__main__":
    print(f"Futu quote bridge: http://127.0.0.1:{BRIDGE_PORT}/market-snapshot")
    ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT), Handler).serve_forever()
