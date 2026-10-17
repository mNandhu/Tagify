"""Routes are served under the versioned `/api/v1` prefix only."""

import httpx


async def test_routes_live_under_api_v1(client):
    resp = await client.get("/libraries")
    assert resp.status_code == 200
    assert str(resp.request.url).endswith("/api/v1/libraries")


async def test_bare_prefix_is_gone(client):
    from src.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        assert (await c.get("/libraries")).status_code == 404
        # Root health stays for container probes; the API copy mirrors it.
        assert (await c.get("/health")).json() == {"status": "ok"}
        assert (await c.get("/api/v1/health")).json() == {"status": "ok"}
