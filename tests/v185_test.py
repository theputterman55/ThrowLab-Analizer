"""v1.8.5: the arm's shoulder end is the Shoulders dot on every frame, and dragging it from Arm mode moves that dot."""
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
        goto = lambda f: (ev(f"{P}.f = {f}"), pg.wait_for_timeout(120))
        pg.click(".ptset[data-set=shoulders]"); click(.40,.30); click(.60,.34)
        goto(3); pg.click("#ptDone"); pg.wait_for_timeout(100)          # shoulders finished at frame 3
        goto(0); pg.click(".ptset[data-set=arm]"); click(.38,.50); click(.36,.66); click(.35,.80)
        # every frame: arm top equals the shoulder anchor, and equals the Shoulders dot wherever that dot exists
        bad = []
        for f in range(0, 12):
            r = ev(f"(()=>{{const p={P},l=p.livePts('arm',{f}),s=p.setPoints('shoulders',{f}),a=p.shoulderAnchor({f});return [l.pts[0],s?s.pts[0]:null,a,l.linked]}})()")
            if not r[3] or r[0] != r[2] or (r[1] and r[0] != r[1]): bad.append((f, r))
        check("arm top connected to the shoulder on every frame", not bad, bad[:2])
        # past the end of the Shoulders set: dragging the arm's shoulder end adds a shoulder keyframe and stretches the range
        goto(9); a9 = ev(f"{P}.livePts('arm',9).pts[0]")
        check("no shoulder dot of its own at frame 9", ev(f"{P}.setPoints('shoulders',9)") is None)
        drag(a9, (a9[0] + .05, a9[1] + .04))
        s = ev(f"{P}.pts.shoulders")
        check("shoulder keyframe created at frame 9, range stretched", "9" in s["kf"] and s["end"] == 9, s)
        l9 = ev(f"{P}.livePts('arm',9).pts[0]")
        check("arm top moved with the shoulder", abs(l9[0] - (a9[0] + .05)) < .02 and abs(l9[1] - (a9[1] + .04)) < .02, (a9, l9))
        check("other shoulder kept", len(s["kf"]["9"]) == 2)
        check("arm elbow untouched", ev(f"{P}.livePts('arm',9).pts[1]") == ev(f"{P}.pts.arm.kf['0'][1]"))
        # inside the range: drag the arm top from Arm mode moves the Shoulders dot
        goto(0); a0 = ev(f"{P}.livePts('arm',0).pts[0]")
        drag(a0, (a0[0] - .03, a0[1] + .02))
        s0 = ev(f"{P}.pts.shoulders.kf['0'][0]"); l0 = ev(f"{P}.livePts('arm',0).pts[0]")
        check("Shoulders dot moved and arm top still sits on it", abs(s0[0] - (a0[0] - .03)) < .02 and s0 == l0, (a0, s0, l0))
        check("no page errors", not errs, errs)
    print("v185 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
