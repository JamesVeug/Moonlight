# Admin maintenance | Reload mob drops
# Pushes mob_drops rows added to the DB into the running server's drop cache, so no restart is needed.
# Every spawned copy of a mob shares its template's drop set, so adding to the cached set applies to all live mobs.
# Only adds missing items; it does not remove or change existing entries.
# Usage (Tester+): !script npc admin_reloadMobDrops

from net.swordie.ms.connection.db import DatabaseManager
from net.swordie.ms.life.drop import DropInfo
from net.swordie.ms.loaders import DropData
from net.swordie.ms.loaders import StringData

MOB_IDS = [8140101] # Black Kentaurus (Leafre)

def getDbDrops(mobId):
    session = DatabaseManager.getSession()
    try:
        transaction = session.beginTransaction()
        query = session.createNativeQuery("SELECT itemid, chance, minquant, maxquant FROM mob_drops WHERE mobid = :mobid")
        query.setParameter("mobid", mobId)
        rows = query.getResultList()
        transaction.commit()
        return rows
    finally:
        session.close()

lines = []
for mobId in MOB_IDS:
    liveDrops = DropData.getDropInfoByID(mobId)
    liveItemIds = set(di.getItemID() for di in liveDrops)
    added = 0
    for row in getDbDrops(mobId):
        itemId = int(row[0])
        if itemId in liveItemIds:
            continue
        minQuant = 1 if row[2] is None else int(row[2])
        maxQuant = 1 if row[3] is None else int(row[3])
        liveDrops.add(DropInfo(itemId, int(row[1]), minQuant, maxQuant))
        liveItemIds.add(itemId)
        added += 1
    lines.append("%s (%d): added %d drops" % (StringData.getMobStringById(mobId), mobId, added))

sm.sendSayOkay("\r\n".join(lines))
sm.dispose()
