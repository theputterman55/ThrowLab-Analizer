"""v1.9.4: Show both players draws the other player's lines (same throw) with P1/P2 badges and readouts on opposite sides."""
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
        def draw_log():
            return ev(f"""(()=>{{const p={P},c=p.ctx,T=[],tx=c.fillText.bind(c);c.fillText=(t,x,y)=>{{T.push([t,x,y]);tx(t,x,y)}};p.render();c.fillText=tx;return T}})()""")
        # Player 1 on the left, Player 2 on the right
        pg.click("#ptPlayer button[data-p='1']"); pg.click(".ptset[data-set=shoulders]"); click(.20,.30); click(.34,.34)
        pg.click(".ptset[data-set=arm]"); click(.20,.50); click(.19,.64); click(.18,.76)
        pg.click("#ptPlayer button[data-p='2']"); pg.click(".ptset[data-set=shoulders]"); click(.66,.30); click(.80,.34)
        pg.click("#ptPlayer button[data-p='1']"); pg.wait_for_timeout(150)
        check("checkbox exists, off by default", pg.is_visible("#showBoth") and not pg.is_checked("#showBoth"))
        names = lambda lg: [t[0] for t in lg if t[0].startswith("P") or "SHOULDER" in t[0] or "ELBOW" in t[0]]
        off = names(draw_log())
        check("off: only Player 1 shows (no badges)", not any(n in ("P1", "P2") for n in off), off)
        pg.check("#showBoth"); pg.wait_for_timeout(150)
        lg = draw_log(); on = names(lg)
        check("on: P1 and P2 badges both drawn", "P1" in on and "P2" in on, on)
        check("on: Player 2's shoulder tilt readout appears", any(n == "P2 SHOULDER TILT" for n in on), on)
        check("on: Player 1's readouts are named too", any(n.startswith("P1 ") for n in on), on)
        W = ev(f"{P}.vsz.W")
        x1 = [t[1] for t in lg if t[0].startswith("P1 ")]; x2 = [t[1] for t in lg if t[0].startswith("P2 ")]
        check("the two players' readouts sit on opposite sides", (max(x1) < W/2) != (max(x2) < W/2), (x1, x2))
        check("the active player's own points are not changed by drawing the other", ev(f"{P}.slot.player") == 1 and ev(f"Object.keys({P}.pts).join()") == "shoulders,arm", ev(f"Object.keys({P}.pts).join()"))
        pg.reload(); pg.wait_for_timeout(2000)
        check("choice is remembered", pg.is_checked("#showBoth"))
        check("no page errors", not errs, errs)
    print("v194 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
