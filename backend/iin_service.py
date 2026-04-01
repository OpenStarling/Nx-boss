import os
import httpx
import hashlib
from typing import Any, Dict, Optional

GBDUL_BIN_URL = os.getenv("GBDUL_BIN_URL", "").strip()
GBDUL_BASIC = os.getenv("GBDUL_BASIC", "").strip()
REQUESTOR_BIN = os.getenv("GBDUL_REQUESTOR_BIN", "970840000277").strip()

# --- СЛОВАРИ ДЛЯ РАЗНООБРАЗНОЙ ГЕНЕРАЦИИ (Взято из вашего файла) ---
# Названия строго совпадают с ключами в SignalsMap.jsx для работы анимации!
REGIONS = [
    ("город Астана", "Есильский район"),
    ("город Шымкент", "Аль-Фарабийский район"),
    ("Акмолинская область", "г. Кокшетау"),
    ("Актюбинская область", "г. Актобе"),
    ("Костанайская область", "г. Костанай"),
    ("Карагандинская область", "г. Караганда"),
    ("Атырауская область", "г. Атырау"),
    ("Мангистауская область", "г. Актау"),
    ("Западно-Казахстанская область", "г. Уральск"),
    ("Северо-Казахстанская область", "г. Петропавловск"),
    ("Павлодарская область", "г. Павлодар"),
    ("Туркестанская область", "г. Туркестан"),
    ("Улытауская область", "г. Жезказган"),
    ("Кызылординская область", "г. Кызылорда"),
]

OKEDS = [
    ("01500", "Смешанное сельское хозяйство"),
    ("28302", "Производство сельскохозяйственных машин"),
    ("50200", "Деятельность морского и прибрежного грузового транспорта"),
    ("41201", "Строительство жилых и нежилых зданий"),
    ("62011", "Деятельность в области компьютерного программирования"),
    ("47111", "Розничная торговля в неспециализированных магазинах"),
    ("86210", "Общая врачебная практика"),
    ("49410", "Грузовые перевозки автомобильным транспортом")
]

COMPANIES = [
    "ТОО 'Инвест Агро'", "АО 'Агромашхолдинг'", "ТОО 'Национальные технологии'",
    "ТОО 'Строй Инвест Каз'", "ТОО 'Глобал Логистик'", "ТОО 'Эко Фудс'",
    "ТОО 'КазТехно Групп'", "ТОО 'Медикал Плюс'", "ТОО 'Азия Трейд'",
    "ТОО 'Next-D'", "ТОО 'Пекарня столицы'", "ТОО 'Алга балам'"
]

def _auth_headers() -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if GBDUL_BASIC:
        h["Authorization"] = GBDUL_BASIC
    return h

async def fetch_org_by_bin(bin12: str) -> Optional[Dict[str, Any]]:
    if not GBDUL_BIN_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                GBDUL_BIN_URL,
                json={"bin": bin12, "requestor_bin": REQUESTOR_BIN},
                headers=_auth_headers(),
            )
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None

# =========================================================================
# УМНЫЙ ДЕМО-ГЕНЕРАТОР: Разнообразные данные на основе БИНа
# =========================================================================
def _get_pseudo_random(bin_str: str, salt: str, items: list) -> Any:
    """Выбирает элемент из списка на основе хэша БИНа (всегда одинаково для одного БИНа)"""
    h = hashlib.md5((str(bin_str) + salt).encode('utf-8')).hexdigest()
    idx = int(h, 16) % len(items)
    return items[idx]

def _generate_fake_iin(seed_str: str, role: str) -> str:
    prefix = "85" if role == "leader" else "90"
    h = hashlib.md5((str(seed_str) + role).encode('utf-8')).hexdigest()
    num_str = str(int(h, 16))
    return (prefix + num_str[-10:].zfill(10))[:12]

async def get_iins_by_bin(bin12: str) -> Dict[str, Any]:
    j = await fetch_org_by_bin(bin12)
    
    # Генерация стабильных разнообразных данных
    region_name, city_name = _get_pseudo_random(bin12, "region", REGIONS)
    oked_code, oked_name = _get_pseudo_random(bin12, "oked", OKEDS)
    company_name = _get_pseudo_random(bin12, "company", COMPANIES) + f" ({bin12[-4:]})"
    
    # 1. Если нет ответа от API - отдаем сгенерированное разнообразие
    if not j or not j.get("data") or not j["data"].get("organization"):
        return {
            "bin": bin12,
            "leaderIIN": _generate_fake_iin(bin12, "leader"),
            "foundersIINs": [_generate_fake_iin(bin12, "founder")],
            "oked": oked_code,
            "okedNameRu": oked_name,
            "districtRu": region_name, # <-- Отдаем РЕГИОН сюда для карты!
            "cityRu": city_name,
            "orgNameRu": company_name,
        }

    # 2. Если API ответил, берем реальное, но добиваем фейком пустые места
    org = j["data"]["organization"]

    leader_iin = (org.get("organizationLeader") or {}).get("IIN") or _generate_fake_iin(bin12, "leader")
    founders_fl = org.get("foundersFL") or []
    founders_iins = [f.get("IIN") for f in founders_fl if isinstance(f, dict) and f.get("IIN")]
    if not founders_iins:
        founders_iins = [_generate_fake_iin(bin12, "founder")]

    activity = org.get("activity") or {}
    address = org.get("address") or {}
    
    return {
        "bin": bin12,
        "leaderIIN": leader_iin,
        "foundersIINs": founders_iins,
        "oked": activity.get("OKED") or oked_code,
        "okedNameRu": activity.get("activityNameRu") or oked_name,
        # Записываем в districtRu именно область, чтобы карта её поймала
        "districtRu": address.get("districtRu") or address.get("districtKz") or region_name,
        "cityRu": address.get("cityRu") or address.get("cityKz") or city_name,
        "orgNameRu": org.get("nameRu") or company_name,
    }