#!/bin/bash
set -euo pipefail

for required in Character.wz Map002.wz/Map String.wz/Skill.img.xml Quest.wz/QuestInfo.img.xml; do
    if [ ! -e "wz/$required" ]; then
        echo "Missing exported v214 WZ data: wz/$required. See LOCAL-SETUP.md." >&2
        exit 1
    fi
done

# MySQL imports schema/data only when its data volume is first created.
# Never run init_database.sh here: it deletes saved accounts and characters.
exec java --enable-preview -jar bin/maplestory-2.13.1-jar-with-dependencies.jar
