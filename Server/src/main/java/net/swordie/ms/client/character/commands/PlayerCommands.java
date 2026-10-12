package net.swordie.ms.client.character.commands;


import net.swordie.ms.client.Account;
import net.swordie.ms.client.User;
import net.swordie.ms.client.character.BroadcastMsg;
import net.swordie.ms.client.character.Char;
import net.swordie.ms.client.character.ExtendSP;
import net.swordie.ms.client.character.items.Item;
import net.swordie.ms.client.character.skills.MatrixRecord;
import net.swordie.ms.client.character.skills.Skill;
import net.swordie.ms.client.character.skills.temp.CharacterTemporaryStat;
import net.swordie.ms.connection.packet.WvsContext;
import net.swordie.ms.constants.GameConstants;
import net.swordie.ms.constants.ItemConstants;
import net.swordie.ms.constants.JobConstants;
import net.swordie.ms.constants.SkillConstants;
import net.swordie.ms.enums.AccountType;
import net.swordie.ms.enums.BaseStat;
import net.swordie.ms.enums.ItemJob;
import net.swordie.ms.enums.Stat;
import net.swordie.ms.life.drop.DropInfo;
import net.swordie.ms.life.mob.Mob;
import net.swordie.ms.loaders.DropData;
import net.swordie.ms.loaders.FieldData;
import net.swordie.ms.loaders.ItemData;
import net.swordie.ms.loaders.SkillData;
import net.swordie.ms.loaders.StringData;
import net.swordie.ms.loaders.VCoreData;
import net.swordie.ms.loaders.containerclasses.VCoreInfo;
import net.swordie.ms.scripts.ScriptManagerImpl;
import net.swordie.ms.scripts.ScriptType;
import net.swordie.ms.util.Rect;
import net.swordie.ms.util.Util;
import org.apache.log4j.LogManager;
import org.apache.log4j.Logger;

import java.text.NumberFormat;
import java.util.*;
import java.util.stream.Collectors;

import static net.swordie.ms.enums.AccountType.Player;
import static net.swordie.ms.enums.AccountType.Tester;
import static net.swordie.ms.enums.ChatType.*;

public class PlayerCommands {
    private static final Logger log = LogManager.getLogger(PlayerCommands.class);

    @Command(names = {"help"}, requiredType = Player)
    public static class Help extends PlayerCommand {

        public static void execute(Char chr, String[] args) {
            for (Class clazz : PlayerCommands.class.getClasses()) {
                Command cmd = (Command) clazz.getAnnotation(Command.class);
                if (chr.getUser().getAccountType().ordinal() >= cmd.requiredType().ordinal()) {
                    StringBuilder str = new StringBuilder(String.format("[%s] ", cmd.requiredType().toString()));
                    for (String cmdName : cmd.names()) {
                        str.append(cmdName);
                        str.append(", ");
                    }
                    chr.chatMessage(Expedition, str.toString());
                }
            }
        }
    }

    @Command(names = {"sell"}, requiredType = Player)
    public static class SellItem extends PlayerCommand {
        public static void execute(Char chr, String[] args) {
            ScriptManagerImpl smi = chr.getScriptManager();
            smi.startScript(0, "inv-seller", ScriptType.Npc);
        }
    }

    @Command(names = {"instance"}, requiredType = Player)
    public static class Instance extends PlayerCommand {

        public static void execute(Char chr, String[] args) {
            // For testing purposes only.
            if (chr.getInstance() != null) {
                chr.chatMessage(chr.getInstance().toString());
                chr.chatMessage("If you're stuck, Relogging will remove your instance!");
            } else {
                chr.chatMessage("You are not in an instance.");
            }
        }
    }

    @Command(names = {"nodes"}, requiredType = Player)
    public static class OpenNodestone extends PlayerCommand {
        public static void execute(Char chr, String[] args) {
            int NodeID = 2435719;
            if (!chr.hasItem(NodeID)) {
                chr.chatMessage("You do not currently possess any tradeable Nodestones");
                return;
            }
            Item item = chr.getInventoryByType(ItemData.getItemInfoByID(NodeID).getInvType()).getItemByItemID(NodeID);
            if (item == null) {
                chr.chatMessage("An error has occurred");
                return;
            }
        /*    ScriptManagerImpl sm = chr.getScriptManager();
            for (int z = 0; z < item.getQuantity(); z++) {
                sm.openNodestone(2435719);
            }*/
            for (int z = 0; z < item.getQuantity(); z++) {
                List<VCoreInfo> infos = new ArrayList<>(VCoreData.getPossibilitiesByJob(chr.getJob()));
                int rng = Util.getRandom(99);
                if (rng < GameConstants.NODE_ENFORCE_CHANCE) {
                    infos = infos.stream().filter(VCoreInfo::isEnforce).collect(Collectors.toList());
                } else if (rng - GameConstants.NODE_ENFORCE_CHANCE < GameConstants.NODE_SKILL_CHANCE) {
                    infos = infos.stream().filter(VCoreInfo::isSkill).collect(Collectors.toList());
                } else {
                    infos = infos.stream().filter(VCoreInfo::isSpecial).collect(Collectors.toList());
                }
                MatrixRecord mr = new MatrixRecord();
                for (int i = 0; i < 3; i++) {
                    VCoreInfo vci = Util.getRandomFromCollection(infos);
                    infos.remove(Util.findWithPred(infos, v -> v.getIconID() == vci.getIconID()));
                    switch (i) {
                        case 0:
                            mr.setIconID(vci.getIconID());
                            mr.setMaxLevel(vci.getMaxLevel());
                            mr.setSkillID1(vci.getSkillID());
                            mr.setSlv(1);
                            if (vci.isSoloNode()) {
                                // stop if the info is a solo node (i.e, 5th job skill/5th job special node)
                                i = 3;
                            } else {
                                // if it's not a solo node, reduce the possibilities to the other non-solo nodes
                                infos = infos.stream().filter(v -> !v.isSoloNode()).collect(Collectors.toList());
                            }
                            break;
                        case 1:
                            mr.setSkillID2(vci.getSkillID());
                            break;
                        case 2:
                            mr.setSkillID3(vci.getSkillID());
                            break;
                    }
                }
           /*     mr.create(chr.getId());
                chr.getMatrixRecords().add(mr);
                infos.clear();
                //chr.write(WvsContext.nodestoneOpenResult(mr));*/
                chr.getMatrixRecords().add(mr);
            }
            chr.write(WvsContext.matrixUpdate(chr.getSortedMatrixRecords(), false, 0, 0));
        }
    }


    @Command(names = {"job"}, requiredType = Player)
    public static class jobAdvance extends PlayerCommand {

        public static void execute(Char chr, String[] args) {
            chr.getScriptManager().startScript(0, "levelUP", ScriptType.Npc);
        }
    }

    @Command(names = {"marvel"}, requiredType = Player)
    public static class marvel extends PlayerCommand {

        public static void execute(Char chr, String[] args) {
            chr.getScriptManager().startScript(0, "marvel", ScriptType.Npc);
        }
    }

    @Command(names = {"check"}, requiredType = Player)
    public static class check extends PlayerCommand {
        public static void execute(Char chr, String[] args) {
            User user = chr.getUser();
            chr.chatMessage(AdminChat, "DP: " + user.getDonationPoints()
                    + "  VP: " + user.getVotePoints()
                    + "  NX: " + user.getNxPrepaid()
                    + "  PQ Points: " + chr.getPQPoints()
                    + "  Dojo Points: " + chr.getDojoPoints());
            chr.chatMessage(AdminChat, "DROP: " + chr.getTotalStat(BaseStat.dropR) + "%" + "  EXP: " + chr.getTotalStat(BaseStat.expR) + "%"
                    + "  MESO: " + chr.getTotalStat(BaseStat.mesoR) + "%"
                    + "  ATT: " + chr.getTotalStat(BaseStat.pad)
                    + "  MATT: " + chr.getTotalStat(BaseStat.mad)
                    + "  Attack Speed: " + chr.getTotalStat(BaseStat.booster));
        }
    }

    @Command(names = {"dispose", "save"}, requiredType = Player)
    public static class save extends PlayerCommand {
        public static void execute(Char chr, String[] args) {
            ScriptManagerImpl smi = chr.getScriptManager();
            // all but field
            smi.stop(ScriptType.Portal);
            smi.stop(ScriptType.Npc);
            smi.stop(ScriptType.Reactor);
            smi.stop(ScriptType.Quest);
            smi.stop(ScriptType.Item);

            chr.dispose();
            if (args[0].equalsIgnoreCase("@save")) {
                chr.chatMessage("Saved Data and Disposed");
            } else {
                chr.chatMessage("Disposed");
            }
        }
    }

    @Command(names = {"mobinfo"}, requiredType = Player)
    public static class MobInfo extends PlayerCommand {

        public static void execute(Char chr, String[] args) {
            Rect rect = new Rect(
                    chr.getPosition().deepCopy().getX() - 200,
                    chr.getPosition().deepCopy().getY() - 200,
                    chr.getPosition().deepCopy().getX() + 200,
                    chr.getPosition().deepCopy().getY() + 200
            );
            Mob mob = chr.getField().getMobs().stream().filter(m -> rect.hasPositionInside(m.getPosition())).findFirst().orElse(null);
            Char controller = chr.getField().getLifeToControllers().getOrDefault(mob, null);
            if (mob != null) {
                chr.chatMessage(SpeakerChannel, String.format("Mob ID: %s | Template ID: %s | Level: %d | HP: %s/%s " +
                                        "| MP: %s/%s | Left: %s | PDR: %s | MDR: %s " +
                                        "| Controller: %s | Exp : %s | NX: %s",
                                NumberFormat.getNumberInstance(Locale.US).format(mob.getObjectId()),
                                NumberFormat.getNumberInstance(Locale.US).format(mob.getTemplateId()),
                                mob.getLevel(),
                                NumberFormat.getNumberInstance(Locale.US).format(mob.getHp()),
                                NumberFormat.getNumberInstance(Locale.US).format(mob.getMaxHp()),
                                NumberFormat.getNumberInstance(Locale.US).format(mob.getMp()),
                                NumberFormat.getNumberInstance(Locale.US).format(mob.getMaxMp()),
                                mob.isLeft(),
                                mob.getPdr(),
                                mob.getMdr(),
                                controller == null ? "null" : chr.getName(),
                                mob.getForcedMobStat().getExp(),
                                mob.getNxDropAmount()
                        )
                );
            } else {
                chr.chatMessage(SpeakerChannel, "Could not find mob.");
            }
        }
    }

    @Command(names = {"whatdrops", "whodrops"}, requiredType = Player)
    public static class WhatDrops extends PlayerCommand {
        private static final int MAX_LINES = 25;
        private static final int MAX_MAPS = 3;

        public static void execute(Char chr, String[] args) {
            if (args.length < 2 || !Util.isNumber(args[1])) {
                chr.chatMessage(SpeakerChannel, "Usage: @whatdrops <itemid>");
                return;
            }
            int itemId = Integer.parseInt(args[1]);
            String itemName = StringData.getItemStringById(itemId);
            if (itemName == null) {
                chr.chatMessage(SpeakerChannel, String.format("Unknown item ID %d.", itemId));
                return;
            }
            chr.chatMessage(SpeakerChannel, String.format("Drops of %s (%d):", itemName, itemId));

            int lines = 0;
            Map<Integer, DropInfo> mobDrops = DropData.getMobDropsByItemId(itemId);
            for (Map.Entry<Integer, DropInfo> entry : mobDrops.entrySet()) {
                if (lines >= MAX_LINES) {
                    chr.chatMessage(SpeakerChannel, String.format("...and %d more mobs.", mobDrops.size() - lines));
                    break;
                }
                int mobId = entry.getKey();
                String mobName = mobId == -1 ? "All mobs (global drop)" : StringData.getMobStringById(mobId);
                String line = String.format("%s (%d) - %s", mobName == null ? "Unknown" : mobName,
                        mobId, formatDrop(entry.getValue()));
                if (mobId != -1) {
                    line += " | " + formatSpawnMaps(mobId);
                }
                chr.chatMessage(SpeakerChannel, line);
                lines++;
            }

            // Level-based drops that any mob can roll (see Mob#dropDrops)
            for (Map.Entry<ItemJob, Map<Integer, Set<DropInfo>>> jobEntry : ItemConstants.equipDropsPerLevel.entrySet()) {
                for (Map.Entry<Integer, Set<DropInfo>> levelEntry : jobEntry.getValue().entrySet()) {
                    int level = levelEntry.getKey();
                    for (DropInfo di : levelEntry.getValue()) {
                        if (di.getItemID() == itemId) {
                            chr.chatMessage(SpeakerChannel, String.format("Any mob Lv %s (%s characters) - %s",
                                    level >= 140 ? "140+" : level + "-" + (level + 9), jobEntry.getKey(), formatDrop(di)));
                            lines++;
                        }
                    }
                }
            }
            for (Map.Entry<Integer, Set<DropInfo>> levelEntry : ItemConstants.consumableDropsPerLevel.entrySet()) {
                int level = levelEntry.getKey();
                for (DropInfo di : levelEntry.getValue()) {
                    if (di.getItemID() == itemId) {
                        chr.chatMessage(SpeakerChannel, String.format("Any mob Lv %s - %s",
                                level >= 100 ? "100+" : level + "-" + (level + 19), formatDrop(di)));
                        lines++;
                    }
                }
            }

            if (lines == 0) {
                chr.chatMessage(SpeakerChannel, "No mobs drop this item.");
            }
        }

        private static String formatDrop(DropInfo di) {
            double basePct = di.getChance() * 100D / GameConstants.MAX_DROP_CHANCE;
            double ratePct = Math.min(100D, basePct * GameConstants.MOB_DROP_RATE);
            String quantity = di.getMinQuant() == di.getMaxQuant()
                    ? "x" + di.getMinQuant()
                    : "x" + di.getMinQuant() + "-" + di.getMaxQuant();
            return String.format("%s%% base, %s%% at %dx rate, %s",
                    formatPct(basePct), formatPct(ratePct), GameConstants.MOB_DROP_RATE, quantity);
        }

        private static String formatSpawnMaps(int mobId) {
            Set<String> mapNames = new LinkedHashSet<>(); // several fields can share a name
            for (int fieldId : FieldData.getFieldIdsByMobId(mobId)) {
                String mapName = StringData.getMapStringById(fieldId);
                mapNames.add(mapName == null ? String.valueOf(fieldId) : mapName);
            }
            if (mapNames.isEmpty()) {
                return "No fixed spawn map (boss, event or scripted spawn)";
            }
            String shown = mapNames.stream().limit(MAX_MAPS).collect(Collectors.joining(", "));
            return mapNames.size() > MAX_MAPS
                    ? String.format("Maps: %s (+%d more)", shown, mapNames.size() - MAX_MAPS)
                    : "Maps: " + shown;
        }

        private static String formatPct(double pct) {
            return new java.text.DecimalFormat("0.##").format(pct);
        }
    }

    @Command(names = {"v", "5th", "5thjob"}, requiredType = Player)
    public static class FifthJob extends PlayerCommand {
        public static void execute(Char chr, String[] args) {
            if (chr.getLevel() >= 200 && !chr.getQuestManager().hasQuestCompleted(1460)) {
                chr.getQuestManager().addQuest(1460);
            } else {
                chr.chatMessage("You must be at least level 200, and not have 5th job already!");
            }
        }
    }

}