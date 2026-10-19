"""v1.5.2: D / A always step frames (Shift = 5), also after using a slider and with a point set active; Arrow tool is R."""
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
        pg = b.new_context(viewport={"width":1500,"height":900}).new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)
        pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
        pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(400)
        cur = lambda: pg.evaluate("Math.round(window.__throwlab.panes[0].f)")
        press = lambda k: (pg.keyboard.press(k), pg.wait_for_timeout(120))
        press("d"); press("d"); check("D steps forward with no tool/set", cur()==2, cur())
        press("a"); check("A steps back", cur()==1, cur())
        press("Shift+D"); check("Shift+D steps 5", cur()==6, cur())
        press("Shift+A"); check("Shift+A steps 5 back", cur()==1, cur())
        press("r"); check("R selects Arrow", pg.get_attribute(".tool[data-tool=arrow]","aria-pressed")=="true")
        pg.click(".ptset[data-set=shoulders]")
        press("d"); check("D steps with a set active", cur()==2, cur())
        # focus a slider (the frame scrubber) and press D
        pg.focus("#scrub"); press("d"); check("D works while a slider has focus", cur()==3, cur())
        bb = pg.locator("#scrub").bounding_box()
        pg.mouse.click(bb["x"]+bb["width"]*0.5, bb["y"]+bb["height"]/2); pg.wait_for_timeout(150)
        f0 = cur(); press("d"); check("D works right after clicking the slider", cur()==f0+1, (f0,cur()))
        check("no page errors", not errs, errs)
        b.close()
    print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
main()
