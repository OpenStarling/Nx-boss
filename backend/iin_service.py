import httpx

GBDUL_BIN_URL = "ТВОЙ_URL_ПО_BIN"
REQUESTOR_BIN = "970840000277"


async def get_iins_by_bin(bin12: str):
    """
    По БИН возвращает:
    {
        "leaderIIN": "...",
        "foundersIINs": [...]
    }
    """

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            GBDUL_BIN_URL,
            json={
                "bin": bin12,
                "requestor_bin": REQUESTOR_BIN
            }
        )

    if response.status_code != 200:
        return None

    data = response.json()
    org = data.get("data", {}).get("organization", {})

    leader_iin = org.get("organizationLeader", {}).get("IIN")

    founders = org.get("foundersFL", [])
    founders_iins = [f.get("IIN") for f in founders if f.get("IIN")]

    return {
        "leaderIIN": leader_iin,
        "foundersIINs": founders_iins
    }