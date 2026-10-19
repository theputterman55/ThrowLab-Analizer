"""v1.9.3: the 1.8.1 compact layout is back, with the newer controls (lock arm, hold/glide), and brighter dim text."""
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
        pg = b.new_context(viewport={"width":1500,"height":1000}, color_scheme="dark").new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)
        pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
        pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(400)
        bx = lambda s: pg.locator(s).bounding_box()
        side = bx(".side")
        check("panel is the 1.8.1 width (300px)", 290 <= side["width"] <= 320, side["width"])
        check("no stacked group boxes", pg.locator("#ptSec .grp").count() == 0)
        inside = lambda s: bx(s) and bx(s)["y"] + bx(s)["height"] < 1000 and bx(s)["x"] >= side["x"]
        check("Player 1/2, Show box, Draw and Throw buttons are on screen", all(inside(s) for s in ("#ptPlayer button[data-p='1']", "#ptPlayer button[data-p='2']", "#boxToggle", "#boxDraw", "#ptThrow button[data-t='1']")))
        check("P1 and P2 share a row with Show box", abs(bx("#ptPlayer")["y"] - bx("#boxToggle")["y"]) < 12)
        check("Undo, Finish, Clear set, Rotate on one line", len({round(bx(s)["y"]/6) for s in ("#ptUndo", "#ptDone", "#ptClear", "#ptRotate")}) == 1)
        check("Between keyframes switch present", pg.is_visible("#ptBlend"))
        pg.click(".ptset[data-set=arm]")
        check("Lock arm shown with Arm active", pg.is_visible("#armLock"))
        check("dim text is bright", pg.eval_on_selector("#boxInfo", "e=>{const m=getComputedStyle(e).color.match(/[\\d.]+/g).map(Number);const c=m.slice(0,3).every(x=>x<=1)?m.slice(0,3).map(x=>x*255):m.slice(0,3);return Math.min(...c)}") > 150)
        check("no page errors", not errs, errs)
    print("v193 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
