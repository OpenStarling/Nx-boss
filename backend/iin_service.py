import os
import httpx
from typing import Any, Dict, Optional


GBDUL_BIN_URL = os.getenv("GBDUL_BIN_URL", "").strip()   # URL запроса по BIN (ЮЛ)
GBDUL_BASIC = os.getenv("GBDUL_BASIC", "").strip()       # если нужно Authorization
REQUESTOR_BIN = os.getenv("GBDUL_REQUESTOR_BIN", "970840000277").strip()


def _auth_headers() -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if GBDUL_BASIC:
        h["Authorization"] = GBDUL_BASIC
    return h


async def fetch_org_by_bin(bin12: str) -> Optional[Dict[str, Any]]:
    """
    Возвращает сырой JSON ответа ГБДЮЛ по БИН.
    """
    if not GBDUL_BIN_URL:
        return None

    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.post(
            GBDUL_BIN_URL,
            json={"bin": bin12, "requestor_bin": REQUESTOR_BIN},
            headers=_auth_headers(),
        )
    if r.status_code != 200:
        return None

    try:
        return r.json()
    except Exception:
        return None


async def get_iins_by_bin(bin12: str) -> Dict[str, Any]:
    """
    По БИН возвращает:
    {
      "bin": "...",
      "leaderIIN": "... or None",
      "foundersIINs": [...],
      "oked": "... or None",
      "okedNameRu": "... or None",
      "districtRu": "... or None",
      "cityRu": "... or None",
      "orgNameRu": "... or None",
    }
    """
    j = await fetch_org_by_bin(bin12)
    if not j:
        return {
            "bin": bin12,
            "leaderIIN": None,
            "foundersIINs": [],
            "oked": None,
            "okedNameRu": None,
            "districtRu": None,
            "cityRu": None,
            "orgNameRu": None,
        }

    org = (j.get("data") or {}).get("organization") or {}

    leader_iin = (org.get("organizationLeader") or {}).get("IIN")
    founders_fl = org.get("foundersFL") or []
    founders_iins = [f.get("IIN") for f in founders_fl if isinstance(f, dict) and f.get("IIN")]

    activity = org.get("activity") or {}
    oked = activity.get("OKED")
    oked_name_ru = activity.get("activityNameRu")

    address = org.get("address") or {}
    district_ru = address.get("districtRu") or address.get("districtKz")
    city_ru = address.get("cityRu") or address.get("cityKz")

    org_name = org.get("fullNameRu") or org.get("shortNameRu") or org.get("fullNameKz")

    return {
        "bin": bin12,
        "leaderIIN": leader_iin,
        "foundersIINs": founders_iins,
        "oked": oked,
        "okedNameRu": oked_name_ru,
        "districtRu": district_ru,
        "cityRu": city_ru,
        "orgNameRu": org_name,
    }