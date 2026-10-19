"""Browser smoke test for ThrowLab Analyzer. Needs: pip install playwright; playwright install chromium; ffmpeg."""
import json, os, subprocess, sys, tempfile, threading, functools, http.server
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
fails = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" :: {detail}" if detail != "" else ""))
    if not cond:
        fails.append(name)

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def make_video(path, fps, secs):
    # WebM, because the Chromium that Playwright installs has no H.264 decoder
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=640x360:rate={fps}:duration={secs}",
                    "-c:v", "libvpx", "-b:v", "1M", path], check=True)

def main():
    tmp = tempfile.mkdtemp()
    v30, v60 = os.path.join(tmp, "t30.webm"), os.path.join(tmp, "t60.webm")
    make_video(v30, 30, 2); make_video(v60, 60, 1)
    srv = serve()
    url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = b.new_context(viewport={"width": 1500, "height": 900}, accept_downloads=True).new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(500)

        pg.set_input_files("section.pane[data-id=A] input[type=file]", v30)
        pg.wait_for_selector("#picker[open]", timeout=15000)
        check("picker opens on first clip", True)
        check("fps detected", "30 fps" in pg.inner_text("section.pane[data-id=A] .pmeta"), pg.inner_text("section.pane[data-id=A] .pmeta"))
        check("four layout cards", pg.locator("#pkCards .card").count() == 4)
        pg.click("#pkHand button[data-hand=L]"); pg.click("#pkCards .card[data-layout=back]"); pg.click("#pkOk"); pg.wait_for_timeout(300)
        tools = pg.eval_on_selector_all(".tool", "els=>els.map(e=>e.dataset.tool)")
        check("back-of-board tools", "board" in tools and "roi" in tools and "path" not in tools, tools)

        bb = pg.locator("section.pane[data-id=A] canvas").bounding_box()
        pos = lambda fx, fy: (bb["x"] + bb["width"] * fx, bb["y"] + bb["height"] * fy)
        count = lambda: int(pg.inner_text("#annCount").split()[0])
        def drag(tool, a, c):
            pg.click(f".tool[data-tool={tool}]")
            pg.mouse.move(*pos(*a)); pg.mouse.down(); pg.mouse.move(*pos(*c), steps=6); pg.mouse.up(); pg.wait_for_timeout(80)
        for i, (tool, a, c) in enumerate([("line", (.2, .2), (.6, .4)), ("arrow", (.3, .7), (.5, .8)), ("circle", (.7, .3), (.8, .3)), ("rect", (.1, .6), (.25, .9))], 1):
            drag(tool, a, c); check(f"draw {tool}", count() == i, count())
        pg.click(".tool[data-tool=angle]")
        for f in [(.5, .5), (.6, .6), (.75, .5)]: pg.mouse.click(*pos(*f))
        pg.wait_for_timeout(80); check("draw angle", count() == 5, count())
        pg.click(".tool[data-tool=board]")
        for f in [(.3, .9), (.7, .9), (.62, .6), (.38, .6)]: pg.mouse.click(*pos(*f))
        pg.wait_for_timeout(80); check("draw board outline", count() == 6, count())
        drag("roi", (.35, .1), (.65, .5))
        check("follow-player box", pg.evaluate("window.__throwlab.panes[0].roi") is not None)
        pg.keyboard.press("Control+z"); pg.wait_for_timeout(80); check("undo", count() == 5, count())

        pg.click("#bNext"); pg.click("#bNext"); pg.wait_for_timeout(300)
        check("frame step", pg.inner_text("#readout").startswith("F 3 / 60"), pg.inner_text("#readout"))

        # ---- zoom / pan / hold ----
        vw = lambda: pg.evaluate("(()=>{const v=window.__throwlab.panes[0].vw;return [v.z,v.tx,v.ty,v.hold]})()")
        check("zoom control visible", pg.is_visible("section.pane[data-id=A] .zoomctl"))
        # point under cursor must stay put when zooming with ctrl+wheel (trackpad pinch)
        check("fit view is letterboxed inside the window", vw()[1] > 0, vw())
        cx, cy = pos(.3, .4)
        pg.mouse.move(cx, cy)
        before = pg.evaluate("window.__throwlab.panes[0].pt({clientX:%f,clientY:%f})" % (cx, cy))
        pg.keyboard.down("Control"); pg.mouse.wheel(0, -80); pg.keyboard.up("Control"); pg.wait_for_timeout(120)
        z, tx, ty, hold = vw()
        after = pg.evaluate("window.__throwlab.panes[0].pt({clientX:%f,clientY:%f})" % (cx, cy))
        check("pinch zooms in", 1.5 < z < 16, z)
        fill = pg.evaluate("(()=>{const p=window.__throwlab.panes[0];const s=p.k*p.vw.z;return [p.vsz.W*s, p.cv.width, p.vw.tx]})()")
        check("zoomed video grows past the old video edges to fill the window", fill[0] > fill[1] and fill[2] <= 0, fill)
        check("zoom keeps point under cursor", abs(before[0] - after[0]) < 0.01 and abs(before[1] - after[1]) < 0.01, (before, after))
        pg.click("section.pane[data-id=A] [data-z=in]"); pg.wait_for_timeout(80)
        check("+ button zooms", vw()[0] > z, vw())
        pg.fill("section.pane[data-id=A] .zoomctl input", "100"); pg.dispatch_event("section.pane[data-id=A] .zoomctl input", "input"); pg.wait_for_timeout(80)
        check("slider reaches 16x", abs(vw()[0] - 16) < 0.01, vw())
        pg.click(".tool[data-tool=line]")
        n0 = count()
        pg.mouse.move(*pos(.4, .4)); pg.mouse.down(); pg.mouse.move(*pos(.7, .6), steps=5); pg.mouse.up(); pg.wait_for_timeout(80)
        check("drawing works while zoomed", count() == n0 + 1, count())
        t0 = vw()[1:3]
        pg.mouse.move(*pos(.5, .5)); pg.keyboard.down("Alt"); pg.mouse.down(); pg.mouse.move(*pos(.3, .35), steps=5); pg.mouse.up(); pg.keyboard.up("Alt"); pg.wait_for_timeout(80)
        check("alt-drag pans", vw()[1:3] != t0, (t0, vw()[1:3]))
        pg.click("section.pane[data-id=A] [data-z=hold]")
        held = vw()
        pg.mouse.move(*pos(.5, .5)); pg.mouse.wheel(0, 400); pg.keyboard.down("Control"); pg.mouse.wheel(0, 400); pg.keyboard.up("Control")
        pg.keyboard.press("0"); pg.click("section.pane[data-id=A] [data-z=fit]", force=True); pg.wait_for_timeout(120)
        check("hold locks zoom and position", vw()[:3] == held[:3] and vw()[3] is True, (held, vw()))
        n1 = count()
        pg.mouse.move(*pos(.4, .45)); pg.mouse.down(); pg.mouse.move(*pos(.6, .55), steps=5); pg.mouse.up(); pg.wait_for_timeout(80)
        check("can still draw on hold", count() == n1 + 1 and vw()[:3] == held[:3], (count(), vw()))
        pg.click("section.pane[data-id=A] [data-z=hold]"); pg.click("section.pane[data-id=A] [data-z=fit]"); pg.wait_for_timeout(80)
        check("fit resets to centered full view", vw()[0] == 1 and vw()[1] >= 0 and vw()[2] >= 0, vw())
        # page zoom must be blocked everywhere; pinch must act on the video only
        blocked = pg.evaluate("""(()=>{const r=[];for(const sel of ['#side','.top','#stage','section.pane[data-id=A] canvas']){const el=document.querySelector(sel);const ev=new WheelEvent('wheel',{ctrlKey:true,deltaY:-50,bubbles:true,cancelable:true});el.dispatchEvent(ev);r.push(ev.defaultPrevented)}return r})()""")
        check("ctrl+wheel never reaches browser page zoom", all(blocked), blocked)
        # two-finger touch pinch on the canvas
        pg.evaluate("""(()=>{const c=document.querySelector('section.pane[data-id=A] canvas'),r=c.getBoundingClientRect();
          const mk=(t,id,x,y)=>c.dispatchEvent(new PointerEvent(t,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,bubbles:true,cancelable:true,isPrimary:id===1}));
          const cx=r.left+r.width/2,cy=r.top+r.height/2;
          mk('pointerdown',1,cx-20,cy);mk('pointerdown',2,cx+20,cy);
          mk('pointermove',1,cx-60,cy);mk('pointermove',2,cx+60,cy);
          mk('pointerup',1,cx-60,cy);mk('pointerup',2,cx+60,cy);})()""")
        pg.wait_for_timeout(80)
        check("touch pinch zooms the video", vw()[0] > 2, vw())
        pg.click("section.pane[data-id=A] [data-z=fit]")
        pg.click("section.pane[data-id=A] [data-z=lens]")
        check("corner magnifier selects zoom window", pg.evaluate("window.__throwlab.state.tool") == "lens")
        pg.keyboard.press("Control+z"); pg.keyboard.press("Control+z"); pg.wait_for_timeout(80)

        pg.click("#layoutBtn"); pg.click("#pkCards .card[data-layout=side]"); pg.click("#pkOk"); pg.wait_for_timeout(300)
        check("side layout is split", pg.is_visible("section.pane[data-id=B]"))
        pg.set_input_files("section.pane[data-id=B] input[type=file]", v60); pg.wait_for_timeout(2500)
        check("second clip loaded at 60 fps", "60 fps" in pg.inner_text("section.pane[data-id=B] .pmeta"))
        pg.click("section.pane[data-id=A] [data-act=rel]")
        pg.click("section.pane[data-id=B] .ph"); pg.click("#bNext"); pg.click("section.pane[data-id=B] [data-act=rel]")
        pg.click("#align"); pg.wait_for_timeout(300)
        fs = pg.evaluate("window.__throwlab.panes.map(p=>[Math.round(p.f),p.rel])")
        check("align releases", all(f == r for f, r in fs), fs)

        with pg.expect_download() as dl: pg.click("#saveSession")
        data = json.load(open(dl.value.path()))
        check("session file", data["app"] == "ThrowLab Analyzer" and len(data["panes"]) == 2)
        with pg.expect_download() as dl: pg.click("#snap")
        check("snapshot png", dl.value.suggested_filename.endswith(".png"))
        # ---- work survives a refresh ----
        pg.wait_for_timeout(1500)
        before = pg.evaluate("window.__throwlab.panes.map(p=>[p.nameEl.textContent,p.ann.length,Math.round(p.f),p.rel])")
        pg.reload(); pg.wait_for_timeout(3500)
        after = pg.evaluate("window.__throwlab.panes.map(p=>[p.nameEl.textContent,p.ann.length,Math.round(p.f),p.rel])")
        check("clip and drawings restored after refresh", after[0][0] != "No clip loaded" and after[0][1] == before[0][1] and after[0][2] == before[0][2], (before, after))
        check("second clip restored", after[1][0] == before[1][0] and after[1][3] == before[1][3], (before, after))
        check("no picker popup after restore", not pg.evaluate("document.getElementById('picker').open"))
        pg.click("#clearSaved"); pg.wait_for_timeout(300); pg.reload(); pg.wait_for_timeout(1500)
        check("clear saved work starts fresh", pg.evaluate("window.__throwlab.panes[0].media") is None)
        check("version badge", pg.inner_text("#ver").startswith("v1."), pg.inner_text("#ver"))
        check("no page errors", not errs, errs)
        b.close()
    print("FAILED:" if fails else "ALL PASSED", fails if fails else "")
    sys.exit(1 if fails else 0)

main()
