# NOVA Finance deployment

This project has three components:

1. GitHub Pages hosts the browser interface.
2. Render hosts `server.cjs`, which keeps the 易中转 API key private.
3. Your Windows computer runs Futu OpenD and `futu_market_bridge.py`. A named Cloudflare Tunnel exposes only the bridge to Render over HTTPS.

## 1. Start the protected local Futu bridge

Copy `futu-bridge.env.example` to `futu-bridge.env` and replace the value with a long random secret. Do not commit that file. Start Futu OpenD, log in, then run `启动富途行情桥接.cmd`.

The bridge keeps listening only on `127.0.0.1:6189`; do not change it to a public address.

## 2. Create a Cloudflare named tunnel

Install Cloudflare Tunnel, create a named tunnel, and configure its ingress target as `http://127.0.0.1:6189`. Start the named tunnel on the same computer that runs Futu OpenD. Copy its HTTPS URL.

The public tunnel URL alone is insufficient to access the bridge because `FUTU_BRIDGE_KEY` is required.

## 3. Deploy the API on Render

Create a Render Web Service from this GitHub repository and use `render.yaml`. Set these private environment variables in Render:

- `EZHONGZHUAN_API_KEY`
- `FUTU_BRIDGE_URL`: the Cloudflare Tunnel HTTPS URL
- `FUTU_BRIDGE_KEY`: exactly the value in your local `futu-bridge.env`
- `ALLOWED_ORIGINS`: `https://YOUR_GITHUB_USERNAME.github.io`

Copy the resulting Render API URL, for example `https://nova-finance-api.onrender.com`.

## 4. Publish the GitHub Pages frontend

In the GitHub repository, set the Actions variable `NOVA_API_BASE_URL` to the Render API URL. Enable Pages with **Source: GitHub Actions**, then push to `main`. The workflow publishes only the browser files; API keys and Futu bridge files are never included in GitHub Pages.

## Operating requirements

For quotes, security search, and intraday charts to work, this Windows computer must remain online with Futu OpenD, the local bridge, and the named Cloudflare Tunnel running. Chat and news continue through Render while the local quote path is unavailable.
