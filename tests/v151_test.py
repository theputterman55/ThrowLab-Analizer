"""v1.5.1: tracker hidden by default, arrow pointer while labeling (also when zoomed), ?tracker=1 brings it back."""
import os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from points_test import serve, check, fails
from playwright.sync_api import sync_playwright

def main():
    tmp = tempfile.mkdtemp(); v = os.path.join(tmp, "t.webm")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=480x270:rate=30:duration=2",
                    "-c:v", "libvpx", "-b:v", "1M", v], check=True)
    srv = serve(); base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for q, on in (("", False), ("?tracker=1", True)):
            pg = b.new_context(viewport={"width": 1500, "height": 900}).new_page()
            errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(base + q); pg.wait_for_timeout(500)
            pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
            pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(400)
            vis = lambda s: pg.is_visible(s)
            check(f"[{q or 'default'}] Body tracking panel visible={on}", vis("#analyze") == on)
            if not on: check("Follow tool absent", pg.query_selector(".tool[data-tool=roi]") is None)
            check(f"[{q or 'default'}] skeleton layer row visible={on}", vis("[data-layer=skeleton]") == on)
            check(f"[{q or 'default'}] measurements panel stays", vis("#meas"))
            check(f"[{q or 'default'}] point labeler stays", vis(".ptset[data-set=shoulders]"))
            if not on:
                P = "window.__throwlab.panes[0]"
                bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
                pg.click(".ptset[data-set=shoulders]")
                pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
                cur = lambda: pg.evaluate("getComputedStyle(document.querySelector('section.pane[data-id=A] canvas')).cursor")
                check("arrow pointer while labeling", cur() == "default", cur())
                pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
                for _ in range(4): pg.mouse.wheel(0, -300)
                pg.wait_for_timeout(300)
                check("zoomed in", pg.evaluate(f"{P}.vw.z") > 1.2, pg.evaluate(f"{P}.vw.z"))
                check("still an arrow when zoomed", cur() == "default", cur())
                pg.click("#ptSets .ptset[aria-pressed=true]")  # leave the labeler
                pg.keyboard.press("v"); pg.wait_for_timeout(150)
                check("cursor tool shows the arrow too when zoomed (no hand)", cur() == "default", cur())
            check(f"[{q or 'default'}] no page errors", not errs, errs)
        b.close()
    print("ALL PASSED" if not fails else f"FAILED: {fails}")
    sys.exit(1 if fails else 0)
main()
