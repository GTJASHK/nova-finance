"""Futu OpenAPI adapter for NOVA Finance.

Requires Futu OpenD on 127.0.0.1:11111 and `python -m pip install futu-api`.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import json
import os
import sys
import hmac

ROOT = os.path.dirname(os.path.abspath(__file__))
BRIDGE_ENV_FILE = os.path.join(ROOT, "futu-bridge.env")


def load_env_file(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as env_file:
            for line in env_file:
                key, separator, value = line.strip().partition("=")
                if separator and key and not os.environ.get(key):
                    os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


load_env_file(BRIDGE_ENV_FILE)
LOCAL_DEPENDENCIES = os.path.join(ROOT, ".futu-sdk")
if os.path.isdir(LOCAL_DEPENDENCIES):
    sys.path.insert(0, LOCAL_DEPENDENCIES)
# The SDK writes logs during import. Keep those local to this project instead of OpenD's app-data folder.
os.environ["APPDATA"] = os.path.join(ROOT, ".futu-runtime")

try:
    from futu import AuType, KLType, Market, OpenQuoteContext, RET_OK, SecurityType, SubType
except ImportError as error:
    raise SystemExit("Missing dependency: install it with `python -m pip install futu-api`.") from error

OPEND_HOST = "127.0.0.1"
OPEND_PORT = 11111
BRIDGE_PORT = 6189
MARKETS = {"hk": (Market.HK,), "us": (Market.US,)}
BRIDGE_ACCESS_KEY = os.environ.get("FUTU_BRIDGE_KEY", "").strip()


def safe_value(value):
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, dict):
        return {str(key): safe_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def number_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def with_quote_context(callback):
    quote_ctx = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
    try:
        return callback(quote_ctx)
    finally:
        quote_ctx.close()


def market_for_futu_code(code):
    prefix = code.split(".", 1)[0].upper()
    return {"HK": "hk", "US": "us"}.get(prefix, "us")


def search_securities(market, query):
    normalized_query = query.lower()
    query_variants = {normalized_query}
    if market == "hk" and normalized_query.isdigit():
        query_variants.add(normalized_query.zfill(5))

    def request(quote_ctx):
        rows = []
        for futu_market in MARKETS[market]:
            ret, data = quote_ctx.get_stock_basicinfo(futu_market, SecurityType.STOCK)
            if ret != RET_OK:
                raise RuntimeError(str(data))
            for _, row in data.iterrows():
                code = str(row.get("code", ""))
                name = str(row.get("name", ""))
                if any(term in code.lower() or term in name.lower() for term in query_variants):
                    rows.append({
                        "code": code.split(".", 1)[-1],
                        "futuCode": code,
                        "name": name,
                        "exchange": code.split(".", 1)[0],
                        "market": market_for_futu_code(code),
                        "source": "Futu OpenAPI",
                    })
                    if len(rows) >= 12:
                        return rows
        return rows
    return with_quote_context(request)


def market_snapshot(codes):
    def request(quote_ctx):
        # A single market without quote permission makes OpenD reject the entire batch.
        # Fetch each symbol independently so accessible HK/US quotes still reach the dashboard.
        snapshots = []
        for code in codes:
            ret, data = quote_ctx.get_market_snapshot([code])
            if ret != RET_OK:
                continue
            snapshots.extend({
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
            } for _, row in data.iterrows())
        return snapshots
    return with_quote_context(request)


def global_state():
    def request(quote_ctx):
        ret, data = quote_ctx.get_global_state()
        if ret != RET_OK:
            raise RuntimeError(str(data))
        return safe_value(data)
    return with_quote_context(request)


def current_kline(code, count):
    def request(quote_ctx):
        ret, data = quote_ctx.subscribe([code], [SubType.K_1M], subscribe_push=False)
        if ret != RET_OK:
            raise RuntimeError(str(data))
        ret, data = quote_ctx.get_cur_kline(code, count, KLType.K_1M, AuType.QFQ)
        if ret != RET_OK:
            raise RuntimeError(str(data))
        return [{"timeKey": str(row.get("time_key", "")), "close": number_or_none(row.get("close"))} for _, row in data.iterrows()]
    return with_quote_context(request)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if BRIDGE_ACCESS_KEY and not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {BRIDGE_ACCESS_KEY}"):
            self.respond(401, {"message": "Unauthorized bridge request."})
            return
        request = urlparse(self.path)
        query = parse_qs(request.query)
        try:
            if request.path == "/market-snapshot":
                codes = [code.strip().upper() for code in query.get("codes", [""])[0].split(",") if code.strip()]
                if not codes or len(codes) > 200:
                    self.respond(400, {"message": "Provide 1 to 200 comma-separated Futu codes."})
                else:
                    self.respond(200, {"snapshots": market_snapshot(codes)})
            elif request.path == "/securities/search":
                market = query.get("market", [""])[0]
                keyword = query.get("q", [""])[0].strip()
                if market not in MARKETS or not keyword:
                    self.respond(400, {"message": "Provide a supported market and stock name or code."})
                else:
                    self.respond(200, {"results": search_securities(market, keyword)})
            elif request.path == "/market-state":
                self.respond(200, {"state": global_state()})
            elif request.path == "/kline":
                code = query.get("code", [""])[0].strip().upper()
                count = min(max(int(query.get("count", ["30"])[0]), 1), 1000)
                if not code:
                    self.respond(400, {"message": "Provide a Futu code."})
                else:
                    self.respond(200, {"bars": current_kline(code, count)})
            else:
                self.respond(404, {"message": "Not found"})
        except Exception as error:
            self.respond(502, {"message": f"Futu OpenD request failed: {error}"})

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
    print(f"Futu market bridge: http://127.0.0.1:{BRIDGE_PORT}")
    ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT), Handler).serve_forever()
