"""v1.9.2: Hold still (default) keeps a line exactly in place between keyframes; Glide blends them."""
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
        click = lambda fx, fy: (pg.mouse.click(bb["x"]+bb["width"]*fx, bb["y"]+bb["height"]*fy), pg.wait_for_timeout(120))
        pg.click(".ptset[data-set=shoulders]"); click(.30,.30); click(.50,.34)   # frame 0
        ev(f"{P}.f = 20"); pg.wait_for_timeout(100)
        ev(f"(()=>{{const p={P};p.ptSnap();const k=p.ensureKey('shoulders',20);k[0]=[.7,.5];k[1]=[.9,.55];p.ptChanged()}})()")
        x = lambda f: ev(f"{P}.setPoints('shoulders',{f}).pts[0][0]")
        check("Hold is the default and the Hold button is lit", pg.get_attribute("#ptBlend button[data-b='0']", "aria-pressed") == "true")
        check("hold: frames 1..19 do not move", all(abs(x(f) - x(0)) < 1e-9 for f in range(1, 20)), [x(f) for f in (0, 1, 10, 19)])
        check("hold: jumps only at the next keyframe", abs(x(20) - .7) < 1e-6)
        pg.click("#ptBlend button[data-b='1']"); pg.wait_for_timeout(100)
        check("glide: the line travels between keyframes", x(0) < x(5) < x(10) < x(19) < x(20), [x(f) for f in (0, 5, 10, 19, 20)])
        pg.reload(); pg.wait_for_timeout(2000)
        check("choice is remembered", pg.get_attribute("#ptBlend button[data-b='1']", "aria-pressed") == "true")
        check("no page errors", not errs, errs)
    print("v192 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
