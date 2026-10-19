"""Point labeler test: place, carry forward, keyframes, interpolation, finish, undo, refresh, Follow-box guard."""
import os, subprocess, sys, tempfile, threading, functools, http.server
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" :: {detail}" if detail != "" else ""))
    if not cond: fails.append(name)

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def main():
    tmp = tempfile.mkdtemp(); v = os.path.join(tmp, "t.webm")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=480x270:rate=30:duration=3",
                    "-c:v", "libvpx", "-b:v", "1M", v], check=True)
    srv = serve(); url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = b.new_context(viewport={"width": 1500, "height": 900}).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)
        pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
        pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(400)
        P = "window.__throwlab.panes[0]"
        ev = lambda js: pg.evaluate(js)
        cur = lambda: ev(f"Math.round({P}.f)")
        bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
        # video is letterboxed inside the window: click inside the middle
        at = lambda fx, fy: (bb["x"] + bb["width"] * fx, bb["y"] + bb["height"] * fy)
        click = lambda fx, fy: (pg.mouse.click(*at(fx, fy)), pg.wait_for_timeout(120))

        pg.click(".ptset[data-set=shoulders]")
        check("set button pressed", pg.get_attribute(".ptset[data-set=shoulders]", "aria-pressed") == "true")
        check("hint asks for first point", "throwing shoulder" in pg.inner_text("#ptHint"), pg.inner_text("#ptHint"))
        click(.40, .40)
        check("hint asks for second point", "other shoulder" in pg.inner_text("#ptHint"), pg.inner_text("#ptHint"))
        click(.55, .45)
        kf = ev(f"{P}.pts.shoulders.kf")
        check("keyframe placed on frame 1", list(kf.keys()) == ["0"] and len(kf["0"]) == 2, kf)

        for _ in range(5): pg.keyboard.press("d")
        pg.wait_for_timeout(200)
        check("D steps forward", cur() == 5, cur())
        r = ev(f"(()=>{{const s={P}.setPoints('shoulders',5);return [s.key,s.pts[0][0]]}})()")
        check("points carry forward to the new frame", r[0] is False and abs(r[1] - kf["0"][0][0]) < 1e-9, r)

        click(.45, .55)   # far from both dots: moves the nearest one here, making a keyframe
        kf = ev(f"{P}.pts.shoulders.kf")
        check("moving a dot makes a keyframe", "5" in kf and kf["5"][0] != kf["0"][0] or kf["5"][1] != kf["0"][1], list(kf.keys()))

        for _ in range(5): pg.keyboard.press("d")
        pg.wait_for_timeout(200)
        pg.keyboard.press("Enter"); pg.wait_for_timeout(200)
        s = ev(f"{P}.pts.shoulders")
        check("Enter finishes the set on this frame", s["end"] == 10 and "10" in s["kf"], s)
        check("no points after the end", ev(f"{P}.setPoints('shoulders',11)") is None)
        check("button shows the range", "✓ 1–11" in pg.inner_text(".ptset[data-set=shoulders]"), pg.inner_text(".ptset[data-set=shoulders]"))

        # interpolation between the keyframes at 5 and 10
        mid = ev(f"(()=>{{const a={P}.pts.shoulders.kf[5],b={P}.pts.shoulders.kf[10],m={P}.setPoints('shoulders',7).pts;return [m[0][0],a[0][0]+(b[0][0]-a[0][0])*0.4]}})()")
        check("frames between keyframes are blended", abs(mid[0] - mid[1]) < 1e-9, mid)
        check("measurement uses the placed points", ev(f"{P}.metric('shoulderTilt',7)") is not None)
        check("metric is blank outside the range", ev(f"{P}.metric('shoulderTilt',20)") is None)
        check("keyframe ticks on timeline", pg.locator("#trbands .ptk").count() == 3, pg.locator("#trbands .ptk").count())

        pg.keyboard.press("a"); pg.wait_for_timeout(150)
        check("A steps back", cur() == 9, cur())

        # undo reverts the last change (the finish), then Edit reopens
        pg.keyboard.press("Control+z"); pg.wait_for_timeout(150)
        check("undo reopens the finish", ev(f"{P}.pts.shoulders.end") is None, ev(f"{P}.pts.shoulders.end"))
        pg.keyboard.press("Enter"); pg.wait_for_timeout(150)
        check("finish again", ev(f"{P}.pts.shoulders.end") == 9, ev(f"{P}.pts.shoulders.end"))
        pg.click("#ptDone"); pg.wait_for_timeout(150)
        check("Edit reopens", ev(f"{P}.pts.shoulders.end") is None)

        # second set + a different color
        pg.click(".ptset[data-set=hips]"); pg.keyboard.press("Home"); pg.wait_for_timeout(100)
        click(.40, .70); click(.55, .72)
        check("hips set placed", ev(f"Object.keys({P}.pts)") == ["shoulders", "hips"], ev(f"Object.keys({P}.pts)"))
        check("lean is computed from placed points", ev(f"{P}.metric('lean',0)") is not None)

        # survives a refresh
        before = ev(f"JSON.stringify({P}.pts)"); pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(3500)
        check("points restored after refresh", ev(f"JSON.stringify({P}.pts)") == before)

        # Follow box guard
        g = ev("""import(new URL('js/pose.js?v='+window.__TL_VERSION, document.baseURI).href).then(m=>{
          const box={x:.2,y:.2,w:.4,h:.5};
          const outside=m.followBox(box,{cx:.1,cy:.4});
          const far=m.followBox(box,{cx:.58,cy:.6}, 1);
          return [JSON.stringify(outside)===JSON.stringify(box), far.x-box.x]})""")
        check("box ignores a body outside it", g[0] is True, g)
        check("box moves at most 20% of its width per frame", g[1] <= 0.2 * 0.4 + 1e-9 and g[1] > 0, g)
        check("no page errors", not errs, errs)
        b.close()
    print("FAILED:" if fails else "ALL PASSED", fails if fails else "")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
