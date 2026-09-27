from fastapi.testclient import TestClient


def test_health():
    from wildintel_zooniverse.web.main import app
    assert TestClient(app).get("/api/health").json() == {"status": "ok"}
