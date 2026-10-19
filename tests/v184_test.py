"""v1.8.4: Lock arm checkbox. Off: elbow and wrist drag independently. On: dragging the elbow carries wrist and hand. Shoulder stays attached either way."""
import os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from points_test import serve, check, fails
from playwright.sync_api import sync_playwright
def main():
    tmp = tempfile.mkdtemp(); v = os.path.join(tmp, "t.webm")
    subprocess.run(["ffmpeg","-y","-loglevel","error","-f","lavfi","-i","testsrc=size=480x270:rate=30:duration=3","-c:v","libvpx","-b:v","1M",v],check=True)
    srv = serve(); url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = b.new_context(viewport={"width":1500,"height":1000}).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)
        pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
        pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(400)
        P = "window.__throwlab.panes[0]"; ev = pg.evaluate
        bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
        sp = lambda fx, fy: (bb["x"]+bb["width"]*fx, bb["y"]+bb["height"]*fy)
        click = lambda fx, fy: (pg.mouse.click(*sp(fx, fy)), pg.wait_for_timeout(120))
        def drag(a, c):
            pg.mouse.move(*sp(*a)); pg.mouse.down(); pg.mouse.move(*sp(*c), steps=8); pg.mouse.up(); pg.wait_for_timeout(150)
        arm = lambda: ev(f"{P}.pts.arm.kf['0']")
        pg.click(".ptset[data-set=shoulders]"); click(.40,.30); click(.60,.34)
        pg.click(".ptset[data-set=arm]")
        check("lock checkbox shown for Arm, off by default", pg.is_visible("#armLock") and not pg.is_checked("#armLock"))
        click(.38,.50); click(.36,.66); click(.35,.80)
        a0 = arm()
        # unlocked: drag the elbow, wrist and hand stay
        drag((.38,.50), (.45,.52))
        a1 = arm()
        check("elbow moved", abs(a1[1][0] - .45) < .02 and abs(a1[1][1] - .52) < .02, a1[1])
        check("unlocked: wrist and hand stay", a1[2] == a0[2] and a1[3] == a0[3], (a0, a1))
        # locked: drag the elbow, wrist and hand follow by the same amount
        pg.check("#armLock"); pg.wait_for_timeout(100)
        drag((.45,.52), (.50,.56))
        a2 = arm(); dx, dy = a2[1][0] - a1[1][0], a2[1][1] - a1[1][1]
        check("locked: elbow moved", abs(dx - .05) < .02, (dx, dy))
        check("locked: wrist follows", abs(a2[2][0] - a1[2][0] - dx) < .003 and abs(a2[2][1] - a1[2][1] - dy) < .003, (a1[2], a2[2]))
        check("locked: hand follows", abs(a2[3][0] - a1[3][0] - dx) < .003, (a1[3], a2[3]))
        # locked: dragging the wrist moves the hand but not the elbow
        e_before = list(a2[1]); drag((a2[2][0], a2[2][1]), (a2[2][0] + .04, a2[2][1] + .02))
        a3 = arm()
        check("locked: wrist drag leaves elbow", a3[1] == e_before and abs(a3[3][0] - a2[3][0] - .04) < .02, (a2, a3))
        # shoulder stays attached when the Shoulders dot moves
        ev(f"{P}.pts.shoulders.kf['0'][0] = [0.3, 0.25]; {P}.ptVer++")
        lp = ev(f"{P}.livePts('arm',0).pts")
        check("arm stays on the moved shoulder, elbow stays put", abs(lp[0][0] - .3) < 1e-6 and lp[1] == a3[1], lp)
        check("no page errors", not errs, errs)
    print("v184 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
