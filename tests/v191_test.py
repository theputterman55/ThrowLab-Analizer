"""v1.9.1: readout boxes sit halfway between the picture edge and the player; elbow and wrist leaders end on the middle of their lines."""
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
        def texts():
            return ev(f"""(()=>{{const p={P},c=p.ctx,log=[],o=c.fillText.bind(c);c.fillText=(t,x,y)=>{{log.push([t,x,y]);o(t,x,y)}};p.render();c.fillText=o;return log}})()""")
        W = ev(f"{P}.vsz.W")
        def run(xs, side):
            ev(f"(()=>{{{P}.pts={{}};{P}.ptVer++}})()")
            pg.click(".ptset[data-set=shoulders]"); click(xs[0], .30); click(xs[1], .34)
            pg.click(".ptset[data-set=arm]"); click(xs[0], .50); click(xs[0]-.02, .64); click(xs[0]-.03, .76)
            lines = ev(f"""(()=>{{const p={P},c=p.ctx,L=[],mv=c.moveTo.bind(c),lt=c.lineTo.bind(c),tx=c.fillText.bind(c),T=[];let last=null;
              c.moveTo=(x,y)=>{{last=[x,y];mv(x,y)}};c.lineTo=(x,y)=>{{L.push([last,[x,y]]);lt(x,y)}};c.fillText=(t,x,y)=>{{T.push([t,x,y]);tx(t,x,y)}};
              p.render();c.moveTo=mv;c.lineTo=lt;c.fillText=tx;return {{L,T}}}})()""")
            return lines
        lg = run((.40, .56), "left")
        pts = ev(f"{P}.livePts('arm',0).pts"); H = ev(f"{P}.vsz.H")
        mid_up = [(pts[0][0]+pts[1][0])/2*W, (pts[0][1]+pts[1][1])/2*H]; mid_fo = [(pts[1][0]+pts[2][0])/2*W, (pts[1][1]+pts[2][1])/2*H]
        ends = [l[1] for l in lg["L"]]
        near = lambda m: any(abs(e[0]-m[0]) < .6 and abs(e[1]-m[1]) < .6 for e in ends)
        check("elbow leader ends on the middle of the upper arm line", near(mid_up), (mid_up, ends))
        check("wrist leader ends on the middle of the forearm line", near(mid_fo), (mid_fo, ends))
        names = [t for t in lg["T"] if t[0] in ("SHOULDER TILT", "ELBOW", "WRIST")]
        left_edge = min(p_[0] for p_ in pts) * W
        mx = max(t[1] for t in names)
        check("boxes moved in from the edge (more than the 10.5 margin)", min(t[1] for t in names) > 18, [t[1] for t in names])
        check("boxes stay clear of the player", mx < left_edge + 1, (mx, left_edge))
        lg = run((.62, .80), "right")
        names = [t for t in lg["T"] if t[0] in ("SHOULDER TILT", "ELBOW", "WRIST")]
        pts = ev(f"{P}.livePts('arm',0).pts"); right_edge = max(p_[0] for p_ in pts) * W
        check("right side: boxes clear of the player and inside the picture", all(t[1] > 0 for t in names) and min(t[1] for t in names) > right_edge * 0.0, [t[1] for t in names])
        check("no page errors", not errs, errs)
    print("v191 done" if not fails else f"{len(fails)} FAILED"); sys.exit(1 if fails else 0)
if __name__ == "__main__": main()
