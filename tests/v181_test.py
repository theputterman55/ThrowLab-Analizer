"""v1.8.1: instruction text hidden behind a ? toggle, Undo/Finish/Rotate row under the set buttons, arrow cursor everywhere."""
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
        bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
        click = lambda fx, fy: (pg.mouse.click(bb["x"]+bb["width"]*fx, bb["y"]+bb["height"]*fy), pg.wait_for_timeout(120))
        vis = pg.is_visible
        check("instructions hidden by default", not vis("#ptInfo") and not pg.locator("#ptSec .helptext").first.is_visible())
        check("Undo / Finish / Rotate row visible", vis("#ptUndo") and vis("#ptDone") and vis("#ptRotate"))
        check("Finish and Rotate disabled with no set", pg.is_disabled("#ptDone") and pg.is_disabled("#ptRotate") and pg.is_disabled("#ptUndo"))
        pg.click(".ptset[data-set=shoulders]")
        check("placing prompt still shows", "Click the throwing shoulder" in pg.inner_text("#ptHint"), pg.inner_text("#ptHint"))
        click(.40,.40); click(.60,.50)
        check("long keyframe hint is hidden", not vis("#ptHint"))
        check("Finish enabled with a set", not pg.is_disabled("#ptDone"))
        # everything the user needs fits on one screen: undo and the step bar are inside the viewport
        for sel in ("#ptUndo", "#ptTrans", "#ptSummary", "#ptRotate"):
            box = pg.locator(sel).bounding_box()
            check(f"{sel} on screen without scrolling", box is not None and box["y"] + box["height"] < 1000, box)
        pg.click("#ptHelp"); pg.wait_for_timeout(120)
        check("? shows the instructions", vis("#ptInfo") and vis("#ptHint"))
        pg.reload(); pg.wait_for_timeout(1500)
        check("help choice is remembered", pg.get_attribute("#ptHelp", "aria-pressed") == "true")
        pg.click("#ptHelp"); pg.wait_for_timeout(100)
        check("? hides them again", not vis("#ptInfo"))
        # no hand cursor with the Cursor tool, even zoomed
        pg.keyboard.press("v")
        bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
        pg.mouse.move(bb["x"]+bb["width"]/2, bb["y"]+bb["height"]/2)
        for _ in range(4): pg.mouse.wheel(0, -300)
        pg.wait_for_timeout(300)
        cur = pg.evaluate("getComputedStyle(document.querySelector('section.pane[data-id=A] canvas')).cursor")
        check("arrow with the Cursor tool when zoomed", cur == "default", cur)
        check("no page errors", not errs, errs)
        pg.screenshot(path="/tmp/claude-0/-home-claude/4f154499-e76a-5d61-a267-3f92ac4ceeed/scratchpad/v181.png")
        b.close()
    print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
main()
