from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_read_health():
    """
    Test that the health endpoint is reachable and returns the correct status.
    """
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
