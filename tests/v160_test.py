"""v1.6.0: Arm set (shared shoulder), labeler step bar + Undo, Player / Throw slots with notes, persistence."""
import os, subprocess, sys, tempfile, json
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
        click = lambda fx, fy: (pg.mouse.click(bb["x"]+bb["width"]*fx, bb["y"]+bb["height"]*fy), pg.wait_for_timeout(120))
        txt = lambda s: pg.inner_text(s)

        # --- Arm set on its own: 4 clicks
        pg.click(".ptset[data-set=arm]")
        check("hint lists the arm points", "elbow" in txt("#ptHint") and "hand" in txt("#ptHint"), txt("#ptHint"))
        click(.40,.30); click(.45,.50); click(.60,.60); click(.70,.50)
        kf = ev(f"{P}.pts.arm.kf")
        check("arm keyframe has 4 points", len(kf.get("0", [])) == 4, kf)
        m = lambda k: ev(f"{P}.metric('{k}')")
        check("elbow angle computed", m("elbow") is not None, m("elbow"))
        check("forearm swing computed", m("forearm") is not None, m("forearm"))
        check("wrist angle computed", m("wristBend") is not None, m("wristBend"))
        check("arm readout shows angles", "Elbow" in txt("#ptRead") and "Wrist" in txt("#ptRead"), txt("#ptRead"))
        check("measurement row shows elbow", txt("#m-elbow") not in ("—", ""), txt("#m-elbow"))
        # --- Undo button
        check("undo enabled", not pg.is_disabled("#ptUndo"))
        pg.click("#ptUndo"); pg.wait_for_timeout(150)
        check("undo removes the arm", ev(f"{P}.pts.arm") is None, ev(f"JSON.stringify({P}.pts)"))
        check("undo disabled when empty", pg.is_disabled("#ptUndo"))

        # --- Shared shoulder: place Shoulders, then Arm needs only 3 clicks
        pg.click(".ptset[data-set=shoulders]"); click(.40,.30); click(.55,.32)
        pg.click(".ptset[data-set=arm]")
        check("arm hint starts at the elbow", txt("#ptHint").startswith("Click the elbow"), txt("#ptHint"))
        click(.45,.50); click(.60,.60); click(.70,.50)
        arm = ev(f"{P}.pts.arm.kf['0']")
        sh = ev(f"{P}.pts.shoulders.kf['0'][0]")
        check("arm took the shoulder from Shoulders", arm and len(arm) == 4 and abs(arm[0][0]-sh[0]) < 1e-6 and abs(arm[0][1]-sh[1]) < 1e-6, [arm, sh])
        # move the shared shoulder: the arm's first point follows
        ev(f"(()=>{{ {P}.pts.shoulders.kf['0'][0]=[0.2,0.2]; {P}.ptVer++; }})()")
        live = ev(f"{P}.livePts('arm',0).pts[0]")
        check("arm shoulder follows Shoulders", abs(live[0]-0.2) < 1e-6 and abs(live[1]-0.2) < 1e-6, live)

        # --- Step bar
        ev(f"(()=>{{ {P}.ensureKey('arm',0); }})()")
        for _ in range(3): pg.keyboard.press("d")
        pg.wait_for_timeout(150); pg.click("#ptFwd"); pg.wait_for_timeout(100)
        check("step bar forward", cur() == 4, cur())
        pg.click("#ptBack"); pg.wait_for_timeout(100)
        check("step bar back", cur() == 3, cur())
        # a drag on frame 3 makes a keyframe, so Prev/Next key have something to hop to
        pg.click(".ptset[data-set=arm]") if ev("window.__throwlab.state.pset") != "arm" else None
        click(.62,.58)
        keys = ev(f"{P}.allKeys()")
        check("keyframes now include 0 and 3", keys == [0, 3], keys)
        pg.click("#ptStart"); pg.wait_for_timeout(100); check("Start jumps to motion start", cur() == 0, cur())
        pg.click("#ptNextKey"); pg.wait_for_timeout(100); check("Next key", cur() == 3, cur())
        pg.click("#ptPrevKey"); pg.wait_for_timeout(100); check("Prev key", cur() == 0, cur())
        pg.click("#ptEnd"); pg.wait_for_timeout(100); check("End jumps to last labeled frame", cur() == 3, cur())
        check("summary shows the motion", "Motion: frame 1" in txt("#ptSummary"), txt("#ptSummary"))
        pg.click("#ptDone"); pg.wait_for_timeout(100)
        check("summary flags the unfinished sets", "not finished" in txt("#ptSummary"), txt("#ptSummary"))
        pg.click("#ptPlay"); pg.wait_for_timeout(200)
        check("step bar play toggles playing", ev("window.__throwlab.state.playing") is True)
        pg.click("#ptPlay"); pg.wait_for_timeout(100)

        # --- Player / throw slots
        check("heading shows player and throw", "player 1 · throw 1" in txt("#ptSlotLbl").lower(), txt("#ptSlotLbl"))
        check("measurements heading shows slot", "p1" in txt("#measPane").lower() and "t1" in txt("#measPane").lower(), txt("#measPane"))
        check("four throw buttons", pg.locator("#ptThrow button").count() == 4)
        pg.fill("#ptNote", "Practice, back-of-board"); pg.wait_for_timeout(150)
        check("description shows under Measurements", "Practice" in txt("#measDesc"), txt("#measDesc"))
        pg.click("#ptThrow button[data-t='2']"); pg.wait_for_timeout(150)
        check("throw 2 starts empty", ev(f"Object.keys({P}.pts).length") == 0)
        check("note is per throw", pg.input_value("#ptNote") == "", pg.input_value("#ptNote"))
        check("heading follows", "throw 2" in txt("#ptSlotLbl").lower() and "t2" in txt("#measPane").lower())
        pg.click(".ptset[data-set=hips]"); click(.40,.60); click(.55,.62)
        check("hips placed on throw 2", ev(f"Object.keys({P}.pts)") == ["hips"], ev(f"Object.keys({P}.pts)"))
        pg.click("#ptPlayer button[data-p='2']"); pg.wait_for_timeout(150)
        check("player 2 throw 2 empty", ev(f"Object.keys({P}.pts).length") == 0)
        pg.click("#ptPlayer button[data-p='1']"); pg.click("#ptThrow button[data-t='1']"); pg.wait_for_timeout(150)
        check("player 1 throw 1 points kept", sorted(ev(f"Object.keys({P}.pts)")) == ["arm", "shoulders"], ev(f"Object.keys({P}.pts)"))
        check("note kept for throw 1", pg.input_value("#ptNote") == "Practice, back-of-board", pg.input_value("#ptNote"))
        check("throw buttons mark used throws", pg.locator("#ptThrow button.has").count() == 2, pg.locator("#ptThrow button.has").count())
        pg.click("#ptThrowAdd"); pg.wait_for_timeout(150)
        check("throw 5 added", pg.locator("#ptThrow button").count() == 5 and "throw 5" in txt("#ptSlotLbl").lower())
        pg.click("#ptThrow button[data-t='2']"); pg.wait_for_timeout(150)

        # --- keyframe ticks still visible (trkonly regression)
        check("keyframe ticks visible", pg.locator(".ptk").first.is_visible() if pg.locator(".ptk").count() else False)

        # --- refresh keeps everything
        before = ev(f"JSON.stringify([{P}.slots,{P}.slot,{P}.nThrows])")
        pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(3500)
        after = ev(f"JSON.stringify([{P}.slots,{P}.slot,{P}.nThrows])")
        check("slots, notes and throw count restored after refresh", before == after, (before[:120], after[:120]))
        check("no page errors", not errs, errs)
        b.close()
    print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
main()
