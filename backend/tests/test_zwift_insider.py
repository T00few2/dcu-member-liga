import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.zwift_insider import ZwiftInsiderService, slugify


def test_slugify_matches_frontend_algorithm():
    assert slugify("Bon Voyage") == "bon-voyage"
    assert slugify("  Big Foot Hills  ") == "big-foot-hills"
    assert slugify("Muir & The Mountain") == "muir-the-mountain"
    assert slugify("Crêpe Escape") == "crepe-escape"
    assert slugify("") == ""
    assert slugify(None) == ""


def _fake_response(html: str, status_ok: bool = True):
    resp = MagicMock()
    resp.text = html
    resp.raise_for_status = MagicMock()
    if not status_ok:
        resp.raise_for_status.side_effect = Exception("boom")
    return resp


def test_get_time_estimates_parses_wkg_tiers_and_rating():
    html = """
    <html><body>
      <div>Rating: 14.4/100</div>
      <div>4 W/kg: 43 minutes</div>
      <div>3 W/kg: 48 minutes</div>
      <div>2 W/kg: 57 minutes</div>
    </body></html>
    """
    service = ZwiftInsiderService()
    with patch("services.zwift_insider.requests.get", return_value=_fake_response(html)) as mock_get:
        result = service.get_time_estimates("Bon Voyage")

    mock_get.assert_called_once()
    called_url = mock_get.call_args[0][0]
    assert called_url == "https://zwiftinsider.com/route/bon-voyage/"
    assert result["slug"] == "bon-voyage"
    assert result["rating"] == 14.4
    assert result["estimates"] == [
        {"wkg": 4.0, "minutes": 43.0},
        {"wkg": 3.0, "minutes": 48.0},
        {"wkg": 2.0, "minutes": 57.0},
    ]
    assert "error" not in result


def test_get_time_estimates_caches_result(monkeypatch):
    html = "<html><body>4 W/kg: 10 minutes</body></html>"
    service = ZwiftInsiderService()
    with patch("services.zwift_insider.requests.get", return_value=_fake_response(html)) as mock_get:
        service.get_time_estimates("Some Route")
        service.get_time_estimates("Some Route")

    assert mock_get.call_count == 1


def test_get_time_estimates_returns_error_shape_on_request_failure():
    service = ZwiftInsiderService()
    with patch("services.zwift_insider.requests.get", side_effect=Exception("network down")):
        result = service.get_time_estimates("Unreachable Route")

    assert result["estimates"] == []
    assert result["rating"] is None
    assert result["error"] == "unavailable"
    assert result["url"] == "https://zwiftinsider.com/route/unreachable-route/"


def test_get_time_estimates_returns_error_shape_when_no_estimates_found():
    html = "<html><body>No data here</body></html>"
    service = ZwiftInsiderService()
    with patch("services.zwift_insider.requests.get", return_value=_fake_response(html)):
        result = service.get_time_estimates("Empty Route")

    assert result["estimates"] == []
    assert result["error"] == "unavailable"
