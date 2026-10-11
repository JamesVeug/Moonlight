maps = [200000120, 200000130, 200000141, 200000110, 200000150, 200000161, 200000170]

menu = "Hey, where would you like to go? #b"
i = 0
while i < len(maps):
    menu += "\r\n#L" + str(i) + "##m" + str(maps[i]) + "#"
    i += 1
answer = sm.sendNext(menu)
sm.warp(maps[answer], 0)
