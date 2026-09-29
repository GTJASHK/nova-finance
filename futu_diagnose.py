import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_DEPENDENCIES = os.path.join(ROOT, ".futu-sdk")
if os.path.isdir(LOCAL_DEPENDENCIES):
    sys.path.insert(0, LOCAL_DEPENDENCIES)
os.environ["APPDATA"] = os.path.join(ROOT, ".futu-runtime")

from futu import Market, OpenQuoteContext, RET_OK, SecurityType

quote_ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
try:
    ret, data = quote_ctx.get_stock_basicinfo(Market.HK, SecurityType.STOCK)
    print("get_stock_basicinfo:", ret)
    if ret == RET_OK:
        matches = data[data["code"].astype(str).str.contains("09988")]
        print(matches[["code", "name"]].to_string(index=False))
    else:
        print(data)
finally:
    quote_ctx.close()
