"""v1.7.0: frame-driven player boxes (red P1 / blue P2), Show box toggle, hand-off between players, persistence."""
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
        cur = lambda: ev(f"Math.round({P}.f)")
        bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
        drag = lambda a, c: (pg.mouse.move(bb["x"]+bb["width"]*a[0], bb["y"]+bb["height"]*a[1]), pg.mouse.down(),
                             pg.mouse.move(bb["x"]+bb["width"]*c[0], bb["y"]+bb["height"]*c[1], steps=6), pg.mouse.up(), pg.wait_for_timeout(150))
        vis = lambda pl, f: ev(f"{P}.pboxVisible({pl},{f})")
        spans = lambda pl: ev(f"{P}.pbox[{pl}].spans")
        pressed = lambda: pg.get_attribute("#boxToggle", "aria-pressed")

        check("Player box tool exists", pg.query_selector(".tool[data-tool=pbox]") is not None)
        check("no box before drawing", not vis(1, 0) and pressed() == "false")
        # Player 1: Show box with no box yet arms the tool
        pg.click("#boxToggle"); pg.wait_for_timeout(100)
        check("Show box with no box selects the Player box tool", ev("window.__throwlab.state.tool") == "pbox")
        drag((.15,.15),(.40,.85))
        check("player 1 box drawn", ev(f"{P}.pbox[1].rect") is not None)
        check("box is on from frame 1, open ended", spans(1) == [[0, None]], spans(1))
        check("button shows on", pressed() == "true" and "on" in pg.inner_text("#boxToggle").lower(), pg.inner_text("#boxToggle"))
        # go to frame 10, switch to player 2, draw: P1 goes off at frame 10
        for _ in range(10): pg.keyboard.press("d")
        pg.wait_for_timeout(150); check("at frame 10", cur() == 10, cur())
        pg.click("#ptPlayer button[data-p='2']"); pg.wait_for_timeout(120)
        check("player 2 has no box yet", pressed() == "false" and "No box for Player 2" in pg.inner_text("#boxInfo"), pg.inner_text("#boxInfo"))
        pg.click("#boxDraw"); drag((.55,.30),(.85,.85))
        check("player 2 box drawn and on from frame 10", spans(2) == [[10, None]], spans(2))
        check("player 1 box went off at frame 10", spans(1) == [[0, 9]], spans(1))
        check("P1 visible at 5, not at 12", vis(1, 5) and not vis(1, 12))
        check("P2 visible at 12, not at 5", vis(2, 12) and not vis(2, 5))
        # playing across the hand-off keeps drawing without errors
        ev(f"{P}.f = 0"); pg.click("#ptPlay"); pg.wait_for_timeout(700); pg.click("#ptPlay")
        # toggle P2 off at frame 20, then on at 30
        ev(f"{P}.f = 20"); pg.wait_for_timeout(100); pg.click("#boxToggle"); pg.wait_for_timeout(100)
        check("toggle off from frame 20", spans(2) == [[10, 19]] and pressed() == "false", spans(2))
        ev(f"{P}.f = 30"); pg.wait_for_timeout(100); pg.click("#boxToggle"); pg.wait_for_timeout(100)
        check("toggle on again at frame 30", spans(2) == [[10, 19], [30, None]], spans(2))
        check("off between", not vis(2, 25) and vis(2, 35))
        # timeline bands in both colors
        check("timeline bands drawn", pg.locator(".pbband").count() == 3, pg.locator(".pbband").count())
        # player buttons colors
        col = lambda sel: pg.evaluate(f"getComputedStyle(document.querySelector(\"{sel}\")).backgroundColor")
        check("player 2 button blue", col("#ptPlayer button[data-p='2']") == "rgb(47, 107, 255)", col("#ptPlayer button[data-p='2']"))
        pg.click("#ptPlayer button[data-p='1']"); pg.wait_for_timeout(100)
        check("player 1 button red", col("#ptPlayer button[data-p='1']") == "rgb(255, 77, 77)", col("#ptPlayer button[data-p='1']"))
        # persistence
        before = ev(f"JSON.stringify({P}.pbox)"); pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(3500)
        check("boxes restored after refresh", ev(f"JSON.stringify({P}.pbox)") == before)
        # clear this player's box
        pg.click("#boxClear"); pg.wait_for_timeout(100)
        check("clear removes player 1 box", ev(f"{P}.pbox[1].rect") is None and ev(f"{P}.pbox[2].rect") is not None)
        pg.click("#clearBox"); pg.wait_for_timeout(100)
        check("Clear boxes removes both", ev(f"{P}.pbox[2].rect") is None)
        check("no page errors", not errs, errs)
        b.close()
    print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
main()
