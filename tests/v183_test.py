"""v1.8.3: the Arm set hangs from the Shoulders dot (first click is the elbow), even outside the shoulders' range; hand is optional."""
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
        # shoulders on frame 10 only
        pg.evaluate(f"{P}.f = 10"); pg.wait_for_timeout(150)
        pg.click(".ptset[data-set=shoulders]"); click(.40,.30); click(.60,.34)
        sh = ev(f"{P}.pts.shoulders.kf['10'][0]")
        # arm on frame 4, BEFORE the shoulders keyframe: first click must be the elbow
        pg.evaluate(f"{P}.f = 4"); pg.wait_for_timeout(150)
        pg.click(".ptset[data-set=arm]")
        check("prompt starts at the elbow", "elbow" in pg.inner_text("#ptHint").lower() and "shoulder is already linked" in pg.inner_text("#ptHint").lower(), pg.inner_text("#ptHint"))
        click(.38,.50)
        check("draft already holds the shoulder", ev(f"{P}.ptDraft.pts.length") == 2 and abs(ev(f"{P}.ptDraft.pts[0][0]") - sh[0]) < 1e-6)
        click(.36,.66)
        check("hint offers skipping the hand", "skip" in pg.inner_text("#ptHint").lower(), pg.inner_text("#ptHint"))
        pg.click("#ptDone"); pg.wait_for_timeout(150)
        arm = ev(f"{P}.pts.arm")
        check("arm saved without clicking the hand", arm and arm["noHand"] and arm["end"] is None and len(arm["kf"]["4"]) == 4, arm)
        check("arm shoulder equals the Shoulders dot", abs(arm["kf"]["4"][0][0] - sh[0]) < 1e-6 or abs(ev(f"{P}.livePts('arm',4).pts[0][0]") - sh[0]) < 1e-6)
        # moving the shoulder moves the arm's shoulder end
        ev(f"{P}.pts.shoulders.kf['10'][0] = [0.5, 0.2]; {P}.ptVer++")
        check("arm follows a moved shoulder", abs(ev(f"{P}.livePts('arm',4).pts[0][0]") - 0.5) < 1e-6)
        check("hand hidden from measurements", ev(f"(()=>{{const f={P}.poseFrame(4);const i=({P}.app.state.hand==='R'?20:19)*3;return f[i+2]}})()") == 0)
        check("center handle uses elbow and wrist only", abs(ev(f"{P}.handleGeom('arm',{P}.livePts('arm',4).pts,1).center[0]") - ev(f"(()=>{{const q={P}.livePts('arm',4).pts,W={P}.vsz.W;return (q[1][0]+q[2][0])/2*W}})()")) < 1e-3)
        # four clicks still works
        pg.click("#ptClear"); pg.wait_for_timeout(150)
        pg.evaluate(f"{P}.f = 4"); pg.wait_for_timeout(150)
        click(.38,.50); click(.36,.66); click(.35,.80)
        a2 = ev(f"{P}.pts.arm")
        check("full four-point arm has a hand", a2 and len(a2["kf"]["4"]) == 4 and not a2.get("noHand"), a2)
        check("no page errors", not errs, errs)
    print("v183 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
