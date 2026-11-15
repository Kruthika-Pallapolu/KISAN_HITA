import unittest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.auth import issue_guest_session
from fastapi import Response

client = TestClient(app)

def _set_guest_cookie():
    # Issue a guest session and set cookie in test client
    resp = Response()
    issue_guest_session(resp)
    cookie_header = resp.headers.get('set-cookie')
    if not cookie_header:
        return
    token = cookie_header.split('=')[1].split(';')[0]
    client.cookies.set('kisan_session', token)

class AssistantValidationTests(unittest.TestCase):
    def setUp(self):
        _set_guest_cookie()

    def test_empty_message_returns_400(self):
        payload = {"message": "   ", "language": "en", "conversation_id": None, "farm_context": None}
        response = client.post("/api/assistant/chat", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Message cannot be empty.")

    def test_missing_message_returns_422(self):
        payload = {"language": "en"}
        response = client.post("/api/assistant/chat", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_valid_message_returns_200(self):
        payload = {"message": "Hello", "language": "en", "conversation_id": None, "farm_context": None}
        response = client.post("/api/assistant/chat", json=payload)
        self.assertEqual(response.status_code, 200)
        json_resp = response.json()
        self.assertIn("reply_text", json_resp)
        self.assertIn("conversation_id", json_resp)

if __name__ == "__main__":
    unittest.main()
