"""v1.8.0: center dot moves the whole line, S shows a rotate pin, Whole set switch, arm behavior, undo."""
import os, subprocess, sys, tempfile, math
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
        W, H = ev(f"[{P}.vsz.W, {P}.vsz.H]")
        scr = lambda x, y: ev(f"(()=>{{const p={P},r=p.cv.getBoundingClientRect(),sc=p.k*p.vw.z;return [r.left+(x*p.vsz.W*sc+p.vw.tx)/p.dpr*(r.width/(p.cv.width/p.dpr)), r.top+(y*p.vsz.H*sc+p.vw.ty)/p.dpr*(r.height/(p.cv.height/p.dpr))]}})()".replace("x*p.vsz","%r*p.vsz" % x).replace("y*p.vsz","%r*p.vsz" % y))
        kf = lambda key, f=0: ev(f"{P}.pts.{key}.kf['{f}']")
        def drag(a, c):
            pg.mouse.move(*a); pg.mouse.down(); pg.mouse.move(*c, steps=8); pg.mouse.up(); pg.wait_for_timeout(150)
        click = lambda x, y: (pg.mouse.click(*scr(x, y)), pg.wait_for_timeout(120))
        close = lambda a, b_, t=0.012: abs(a - b_) < t

        # Shoulders on frame 0
        pg.click(".ptset[data-set=shoulders]"); click(.40,.40); click(.60,.50)
        s0 = kf("shoulders"); c0 = [(s0[0][0]+s0[1][0])/2, (s0[0][1]+s0[1][1])/2]
        # --- center move
        a = scr(*c0); drag(a, (a[0]+60, a[1]+30))
        s1 = kf("shoulders"); c1 = [(s1[0][0]+s1[1][0])/2, (s1[0][1]+s1[1][1])/2]
        dx = [s1[i][0]-s0[i][0] for i in (0,1)]; dy = [s1[i][1]-s0[i][1] for i in (0,1)]
        check("center drag moves both points the same", close(dx[0], dx[1]) and close(dy[0], dy[1]) and dx[0] > 0.02, [dx, dy])
        check("line keeps its length and tilt", close(math.hypot((s1[1][0]-s1[0][0])*W,(s1[1][1]-s1[0][1])*H), math.hypot((s0[1][0]-s0[0][0])*W,(s0[1][1]-s0[0][1])*H), 1.0))
        # --- undo restores it
        pg.click("#ptUndo"); pg.wait_for_timeout(120)
        s2 = kf("shoulders"); check("undo puts the line back", close(s2[0][0], s0[0][0], 1e-6) and close(s2[1][1], s0[1][1], 1e-6), [s2, s0])
        # --- rotate pin
        check("pin hidden by default", ev("window.__throwlab.state.prot") is False)
        pg.keyboard.press("s"); pg.wait_for_timeout(120)
        check("S shows the rotate pin", ev("window.__throwlab.state.prot") is True and pg.get_attribute("#ptRotate","aria-pressed") == "true")
        u = ev(f"{P}.vsz.W/1280/{P}.vw.z")
        g = ev(f"(()=>{{const p={P};return p.handleGeom('shoulders', p.livePts('shoulders',0).pts, {u})}})()")
        piv = g["pivot"]; pin = g["pin"]
        pivn = [piv[0]/W, piv[1]/H]; pinn = [pin[0]/W, pin[1]/H]
        radius = math.hypot(pin[0]-piv[0], pin[1]-piv[1])
        pinscr = scr(*pinn); pivscr = scr(*pivn)
        # drag the pin to the right of the pivot (a quarter turn counter-clockwise on screen)
        sr = math.hypot(pinscr[0]-pivscr[0], pinscr[1]-pivscr[1])
        drag(pinscr, (pivscr[0]+sr, pivscr[1]))
        r1 = kf("shoulders")
        ang = lambda k: math.degrees(math.atan2((k[1][1]-k[0][1])*H, (k[1][0]-k[0][0])*W))
        d_ang = ang(r1) - ang(s0); d_ang = (d_ang + 180) % 360 - 180
        check("rotation turned the line about 90 degrees", abs(abs(d_ang) - 90) < 4, d_ang)
        check("rotation keeps the length", close(math.hypot((r1[1][0]-r1[0][0])*W,(r1[1][1]-r1[0][1])*H), math.hypot((s0[1][0]-s0[0][0])*W,(s0[1][1]-s0[0][1])*H), 1.5))
        rc = [(r1[0][0]+r1[1][0])/2, (r1[0][1]+r1[1][1])/2]
        check("rotation pivots on the center", close(rc[0], c0[0], 0.004) and close(rc[1], c0[1], 0.004), [rc, c0])
        pg.click("#ptUndo"); pg.wait_for_timeout(120)
        pg.keyboard.press("s"); pg.wait_for_timeout(100)
        check("S hides the pin again", ev("window.__throwlab.state.prot") is False)

        # --- Whole set: add a keyframe on frame 5, then move from frame 0
        for _ in range(5): pg.keyboard.press("d")
        pg.wait_for_timeout(150)
        click(.40, .40)   # nearest dot moves here: keyframe on frame 5
        k5 = kf("shoulders", 5)
        pg.click("#ptScope button[data-s='all']"); pg.wait_for_timeout(100)
        check("Whole set selected", ev("window.__throwlab.state.pwhole") is True)
        pg.keyboard.press("Home"); pg.wait_for_timeout(150)
        k0 = kf("shoulders", 0); c = [(k0[0][0]+k0[1][0])/2, (k0[0][1]+k0[1][1])/2]
        a = scr(*c); drag(a, (a[0]+40, a[1]+40))
        k0b = kf("shoulders", 0); k5b = kf("shoulders", 5)
        d0 = [k0b[0][0]-k0[0][0], k0b[0][1]-k0[0][1]]; d5 = [k5b[0][0]-k5[0][0], k5b[0][1]-k5[0][1]]
        check("whole set moved every keyframe the same", close(d0[0], d5[0], 1e-6) and close(d0[1], d5[1], 1e-6) and d0[0] > 0.01, [d0, d5])
        pg.click("#ptScope button[data-s='from']")

        # --- Arm: shoulder stays on the Shoulders points, rest of the arm moves/turns
        pg.click(".ptset[data-set=arm]")
        ev(f"{P}.f = 0"); pg.wait_for_timeout(100)
        click(.45,.55); click(.60,.65); click(.70,.55)
        arm = kf("arm"); sh = kf("shoulders", 0)[0]
        el0 = arm[1]; wr0 = arm[2]; hd0 = arm[3]
        g = ev(f"(()=>{{const p={P};return p.handleGeom('arm', p.livePts('arm',0).pts, {u})}})()")
        cs = scr(g["center"][0]/W, g["center"][1]/H); drag(cs, (cs[0]+30, cs[1]+20))
        arm1 = kf("arm"); sh1 = kf("shoulders", 0)[0]
        check("arm move leaves the shoulder alone", close(sh1[0], sh[0], 1e-6) and close(sh1[1], sh[1], 1e-6))
        check("arm move slides elbow, wrist, hand", arm1[1][0] > el0[0] + 0.01 and arm1[2][0] > wr0[0] + 0.01 and arm1[3][0] > hd0[0] + 0.01, [el0, arm1[1]])
        pg.click("#ptUndo"); pg.wait_for_timeout(100)
        pg.keyboard.press("s"); pg.wait_for_timeout(100)
        pivA = ev(f"(()=>{{const p={P};return p.handleGeom('arm', p.livePts('arm',0).pts, {u})}})()")
        pn = scr(pivA["pin"][0]/W, pivA["pin"][1]/H); pv = scr(pivA["pivot"][0]/W, pivA["pivot"][1]/H)
        sr = math.hypot(pn[0]-pv[0], pn[1]-pv[1]); drag(pn, (pv[0]+sr, pv[1]))
        arm2 = kf("arm"); L = lambda q: math.hypot((q[0]-sh[0])*W, (q[1]-sh[1])*H)
        check("arm rotation pivots at the shoulder (lengths kept)", close(L(arm2[1]), L(el0), 1.5) and close(L(arm2[2]), L(wr0), 1.5), [L(arm2[1]), L(el0)])
        check("arm rotation moved the wrist", abs(arm2[2][1] - wr0[1]) > 0.03, [arm2[2], wr0])
        pg.keyboard.press("s")
        # --- S outside the labeler is still the Square tool
        pg.click(".ptset[data-set=arm]"); pg.wait_for_timeout(100)
        check("labeler off", ev("window.__throwlab.state.pset") is None)
        pg.keyboard.press("s"); pg.wait_for_timeout(100)
        check("S picks Square when no set is active", ev("window.__throwlab.state.tool") == "rect", ev("window.__throwlab.state.tool"))
        check("no page errors", not errs, errs)
        b.close()
    print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
main()
