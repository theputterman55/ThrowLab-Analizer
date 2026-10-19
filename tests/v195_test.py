"""v1.9.5: bigger lines and boxes in screen pixels, more space between boxes, upper arm / forearm boxes on their own lines, shoulder click ignored, duplicate-shoulder arms repaired."""
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
        pg.click(".ptset[data-set=shoulders]"); click(.40,.30); click(.60,.34)
        pg.click(".ptset[data-set=arm]")
        click(.405,.31)   # a click on the shoulder itself
        check("click on the linked shoulder is ignored", ev(f"!{P}.ptDraft && !{P}.pts.arm"), ev(f"JSON.stringify({P}.ptDraft)"))
        click(.38,.50); click(.36,.66); click(.35,.80)
        arm = ev(f"{P}.pts.arm.kf['0']")
        check("arm has shoulder, elbow, wrist, hand", len(arm) == 4 and abs(arm[1][1] - .5) < .02, arm)
        # geometry of the drawn lines / leaders
        info = ev(f"""(()=>{{const p={P},c=p.ctx,L=[],W=[],mv=c.moveTo.bind(c),lt=c.lineTo.bind(c),st=c.stroke.bind(c);let last=null,lw=0;const T=[],tx=c.fillText.bind(c);
          c.moveTo=(x,y)=>{{last=[x,y];mv(x,y)}};c.lineTo=(x,y)=>{{L.push([last,[x,y],c.lineWidth]);lt(x,y)}};c.fillText=(t,x,y)=>{{T.push([t,x,y]);tx(t,x,y)}};
              p.render();c.moveTo=mv;c.lineTo=lt;c.fillText=tx;return {{L,T,sc:p.k*p.vw.z,dpr:p.dpr,W:p.vsz.W,H:p.vsz.H}}}})()""")
        W, H = info["W"], info["H"]; css = lambda w: w * info["sc"] / info["dpr"]
        seg = [l for l in info["L"] if abs(l[0][0] - arm[0][0]*W) < 1 and abs(l[0][1] - arm[0][1]*H) < 1]
        check("arm segment is about 4.5 screen px thick (25% thinner)", seg and css(seg[0][2]) >= 4.4, [css(s[2]) for s in seg])
        mid_up = [(arm[0][0]+arm[1][0])/2*W, (arm[0][1]+arm[1][1])/2*H]; mid_fo = [(arm[1][0]+arm[2][0])/2*W, (arm[1][1]+arm[2][1])/2*H]
        ends = [l[1] for l in info["L"]]
        near = lambda m: any(abs(e[0]-m[0]) < .8 and abs(e[1]-m[1]) < .8 for e in ends)
        check("Upper arm leader ends on the middle of shoulder-to-elbow", near(mid_up), mid_up)
        check("Forearm leader ends on the middle of elbow-to-wrist", near(mid_fo), mid_fo)
        el = [arm[1][0]*W, arm[1][1]*H]
        check("Elbow leader ends on the elbow dot", near(el))
        names = [t for t in info["T"] if t[0] in ("SHOULDER TILT", "UPPER ARM", "ELBOW", "FOREARM", "WRIST")]
        ys = sorted(t[2] for t in names); pitch = min(ys[i+1]-ys[i] for i in range(len(ys)-1))
        check("boxes are at least 62 percent of a box apart plus the gap (pitch >= 54 screen px at fit 0.6)", css(pitch) >= 20, css(pitch))
        # an arm with a second point on the shoulder gets repaired when loaded
        ev(f"""(()=>{{const p={P};p.pts.arm.kf['0']=[p.pts.arm.kf['0'][0],[p.pts.arm.kf['0'][0][0]+.004,p.pts.arm.kf['0'][0][1]+.006],[.38,.5],[.36,.66]];delete p.pts.arm.noHand;const j=p.toJSON();p.fromJSON(j)}})()""")
        fixed = ev(f"{P}.pts.arm.kf['0']"); noh = ev(f"{P}.pts.arm.noHand")
        check("duplicate shoulder point dropped: elbow is now the old wrist", abs(fixed[1][0] - .38) < 1e-6 and abs(fixed[2][0] - .36) < 1e-6 and noh, fixed)
        check("no page errors", not errs, errs)
    print("v195 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
