"""v1.9.0: angle readouts are big boxes stacked in the margin on the player's side, with names, not overlapping."""
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
        def texts():
            return ev(f"""(()=>{{const p={P},c=p.ctx,log=[],o=c.fillText.bind(c);c.fillText=(t,x,y)=>{{log.push([t,x,y]);o(t,x,y)}};p.render();c.fillText=o;return log}})()""")
        W = ev(f"{P}.vsz.W")
        for side, xs in (("left", (.20, .36)), ("right", (.62, .80))):
            ev(f"(()=>{{{P}.pts={{}};{P}.ptVer++}})()")
            pg.click(".ptset[data-set=shoulders]"); click(xs[0], .30); click(xs[1], .34)
            pg.click(".ptset[data-set=arm]"); click(xs[0], .50); click(xs[0]-.02, .64); click(xs[0]-.03, .76)
            lg = texts(); names = [t for t in lg if t[0] in ("SHOULDER TILT", "UPPER ARM", "ELBOW", "FOREARM", "WRIST")]
            vals = [t for t in lg if "°" in t[0]]
            check(f"{side}: five named readouts", len(names) == 5 and len(vals) == 5, lg)
            xsn = [t[1] for t in names]
            check(f"{side}: boxes in the {side} margin", all(x < W / 2 for x in xsn) if side == "left" else all(x > W / 2 for x in xsn), xsn)
            ys = sorted(t[2] for t in names)
            check(f"{side}: stacked without overlapping", all(ys[i+1] - ys[i] >= 15 for i in range(len(ys)-1)), ys)
            pg.keyboard.press("Escape")
        check("no page errors", not errs, errs)
    print("v190 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
