"""Tracking-range test: track a shot, extend it by stepping, direction toggle, persistence. Uses a synthetic clip
(no person in it), so it checks which frames get tracked, not skeleton quality."""
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
    srv = serve(); url = f"http://127.0.0.1:{srv.server_address[1]}/index.html?tracker=1"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = b.new_context(viewport={"width": 1500, "height": 900}).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)
        pg.set_input_files("section.pane[data-id=A] input[type=file]", v)
        pg.wait_for_selector("#picker[open]", timeout=15000); pg.click("#pkOk"); pg.wait_for_timeout(300)
        pg.select_option("#model", "lite")
        rng = lambda: pg.evaluate("window.__throwlab.panes[0].ranges()")
        cnt = lambda: pg.evaluate("window.__throwlab.panes[0].trCount")
        cur = lambda: pg.evaluate("Math.round(window.__throwlab.panes[0].f)")
        def goto(n):
            pg.evaluate("(n)=>{const s=document.getElementById('scrub');s.value=n;s.dispatchEvent(new Event('input'))}", n); pg.wait_for_timeout(200)
        def wait_for(fn, t=120000):
            pg.wait_for_function(fn, timeout=t)

        check("frame counter shows", pg.inner_text("#trFrame").startswith("Frame 1 / 90"), pg.inner_text("#trFrame"))
        pg.evaluate("window.__throwlab.panes[0].roi={x:.2,y:.1,w:.5,h:.7}")

        # 1. track a shot: start at frame 21 (index 20), play, stop after a few frames
        goto(20)
        pg.click("#trPlay")
        check("play button turns red while tracking", "rec" in (pg.get_attribute("#trPlay", "class") or ""))
        wait_for("window.__throwlab.panes[0].trCount >= 4")
        pg.click("#trPlay"); pg.wait_for_function("document.getElementById('trPlay').className.indexOf('rec')<0", timeout=60000)
        r = rng(); a, z = r[0]
        check("range starts where play started", a == 20 and len(r) == 1, r)
        check("frame counter shows range", "Tracked frames:" in pg.inner_text("#trRange"), pg.inner_text("#trRange"))
        check("timeline band drawn", pg.locator("#trbands .trband").count() == 1)
        check("box recorded on tracked frames", pg.evaluate("window.__throwlab.panes[0].boxes[20]") is not None)
        check("paused on last tracked frame", cur() == z, (cur(), z))

        # 2. extend backwards by stepping from the first tracked frame
        goto(a)
        pg.click("#trPrev"); pg.wait_for_function(f"window.__throwlab.panes[0].tr[{a-1}]===1", timeout=60000)
        pg.click("#trPrev"); pg.wait_for_function(f"window.__throwlab.panes[0].tr[{a-2}]===1", timeout=60000)
        check("stepping back extends the range", rng() == [[a - 2, z]], rng())
        check("badge says tracked", pg.inner_text("#trHere").lower() == "tracked", pg.inner_text("#trHere"))

        # 3. stepping next to nothing does not track
        n0 = cnt(); goto(70); pg.click("#trNext"); pg.wait_for_timeout(600)
        check("step away from the range only moves", cnt() == n0 and cur() == 71, (cnt(), n0, cur()))
        check("badge says not tracked", pg.inner_text("#trHere").lower() == "not tracked", pg.inner_text("#trHere"))
        check("box hidden off the range", pg.evaluate("window.__throwlab.panes[0].tr[71]") == 0)

        # 4. play backward from the front of the range
        goto(a - 2); pg.click("#trDir")
        check("direction toggle", "backward" in pg.inner_text("#trDir"), pg.inner_text("#trDir"))
        pg.click("#trPlay"); wait_for(f"window.__throwlab.panes[0].tr[{a-5}]===1")
        pg.click("#trPlay"); pg.wait_for_function("document.getElementById('trPlay').className.indexOf('rec')<0", timeout=60000)
        r = rng(); check("backward play extended the front", len(r) == 1 and r[0][0] <= a - 5 and r[0][1] == z, r)

        # 5. a second shot is its own range
        goto(60); pg.click("#trDir"); pg.click("#trPlay"); wait_for("window.__throwlab.panes[0].tr[62]===1")
        pg.click("#trPlay"); pg.wait_for_function("document.getElementById('trPlay').className.indexOf('rec')<0", timeout=60000)
        check("second shot is a separate range", len(rng()) == 2, rng())

        # 6. survives a refresh
        before = rng(); pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(3500)
        check("ranges restored after refresh", rng() == before, (before, rng()))
        check("timeline bands restored", pg.locator("#trbands .trband").count() == len(before))

        # 7. clear
        pg.click("#clearPose"); pg.wait_for_timeout(200)
        check("clear tracking empties ranges", rng() == [] and cnt() == 0)
        check("no page errors", not errs, errs)
        b.close()
    print("FAILED:" if fails else "ALL PASSED", fails if fails else "")
    sys.exit(1 if fails else 0)

main()
