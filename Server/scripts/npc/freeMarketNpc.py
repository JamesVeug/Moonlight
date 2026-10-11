# Maple Admin (9000087) - Free Market entrance / quick move
Freemarket = 910000000

if sm.getFieldID() == Freemarket:
    if sm.sendAskYesNo("Would you like to leave the Free Market?"):
        ret = sm.getReturnField()
        if ret <= 0:
            ret = 100000000  # Henesys fallback
        sm.warp(ret, 0)
elif sm.sendAskYesNo("Would you like to be teleported to the #bFree Market#k?"):
    sm.setReturnField()
    sm.warp(Freemarket)
