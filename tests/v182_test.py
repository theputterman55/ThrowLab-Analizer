"""v1.8.2: larger inspector, stacked boxed groups, Rotate visible, brighter dimmed text."""
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
        ctx = b.new_context(viewport={"width":1500,"height":1000}); pg = ctx.new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)
        pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
        pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(400)
        fs = lambda sel: float(pg.eval_on_selector(sel, "e=>parseFloat(getComputedStyle(e).fontSize)"))
        check("button text >= 16px", fs("#ptUndo") >= 16, fs("#ptUndo"))
        check("note text >= 15px", fs("#boxInfo") >= 15, fs("#boxInfo"))
        check("inspector wider than 360px", pg.locator(".side").bounding_box()["width"] >= 360)
        check("groups are boxed", pg.locator("#ptSec .grp").count() == 4)
        pg.click(".ptset[data-set=shoulders]")
        sets = pg.locator(".ptset"); ys = [sets.nth(i).bounding_box()["y"] for i in range(sets.count())]
        check("point sets stack vertically", all(ys[i] < ys[i+1] for i in range(len(ys)-1)), ys)
        r = pg.locator("#ptRotate").bounding_box(); d = pg.locator("#ptDone").bounding_box()
        check("Rotate visible, same size as Finish", pg.is_visible("#ptRotate") and abs(r["height"]-d["height"]) < 2 and r["width"] > 100, (r, d))
        check("all four actions inside the panel", all(pg.locator(s).bounding_box()["x"]+pg.locator(s).bounding_box()["width"] <= pg.locator(".side").bounding_box()["x"]+pg.locator(".side").bounding_box()["width"] for s in ("#ptUndo","#ptDone","#ptRotate","#ptClear")))
        check("disabled buttons only lightly dimmed", float(pg.eval_on_selector("#ptSeed, #ptClear", "e=>getComputedStyle(e).opacity")) >= .85)
        pg.screenshot(path=os.path.join(tmp, "v182.png"))
        print("shot", os.path.join(tmp, "v182.png"))
        check("no page errors", not errs, errs)
    print("v182 done" if not fails else f"{len(fails)} FAILED")
    sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
