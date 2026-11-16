// The 3D view in a mod's details: the model the mod draws with its toggles as they are now, read from its own files
// (gacha-core mesh.rs). Drag to turn, scroll to zoom; arrow keys and a controller's d-pad turn it too. "Use as preview"
// saves the current view as the mod's picture. Loaded only when opened, since three.js is large. Owner: LIBRARY area.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { errorText, modtools, type GameId, type ModMesh } from "../../lib/api";
import { Button, IconButton } from "../../ui/kit";

const bytes = (b64: string) => {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};
const f32 = (b64: string) => new Float32Array(bytes(b64).buffer);
const u32 = (b64: string) => new Uint32Array(bytes(b64).buffer);

interface View {
  turn: (deg: number) => void;
  tilt: (deg: number) => void;
  zoom: (k: number) => void;
  reset: () => void;
  /** The current view at 16:9, the shape of a preview. */
  snap: () => Promise<Blob | null>;
}

const TIP = "Drag to turn, scroll to zoom, right-drag to move. Arrow keys turn it, + and - zoom, Home resets the view";

export default function ModViewer({ game, modId, onClose, onSnapshot, saving }: {
  game: GameId; modId: string; onClose: () => void; onSnapshot: (png: Blob) => void; saving?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [mesh, setMesh] = useState<ModMesh | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setMesh(null);
    setError(null);
    modtools.mesh(game, modId).then((m) => { if (live) setMesh(m); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [game, modId]);

  useEffect(() => {
    const el = box.current;
    if (!mesh || !el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const bg = getComputedStyle(el).backgroundColor;
    renderer.setClearColor(new THREE.Color(/^rgba\(.*,\s*0\)$/.test(bg) ? "#202329" : bg));
    const canvas = renderer.domElement;
    canvas.className = "mod-viewer-canvas";
    el.prepend(canvas);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 3);
    scene.add(sun);

    const owned: Array<{ dispose: () => void }> = [];
    let render = () => {};
    const loader = new THREE.TextureLoader();
    const textures = mesh.textures.map((url) => {
      const t = loader.load(url, () => render());
      t.colorSpace = THREE.SRGBColorSpace;
      // the game's UVs start at the top of the image
      t.flipY = false;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      owned.push(t);
      return t;
    });

    const root = new THREE.Group();
    scene.add(root);
    const attrs = mesh.buffers.map((b, i) => {
      const pos = new THREE.BufferAttribute(f32(b.positions), 3);
      const uv = b.uvs ? new THREE.BufferAttribute(f32(b.uvs), 2) : null;
      let nrm = b.normals ? new THREE.BufferAttribute(f32(b.normals), 3) : null;
      if (!nrm) {
        // no normals in the buffer: work them out once from every part that uses it
        const all = mesh.parts.filter((p) => p.buffer === i).flatMap((p) => Array.from(u32(p.indices)));
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", pos);
        g.setIndex(all);
        g.computeVertexNormals();
        nrm = g.getAttribute("normal") as THREE.BufferAttribute;
        g.dispose();
      }
      return { pos, uv, nrm };
    });
    for (const p of mesh.parts) {
      const a = attrs[p.buffer];
      if (!a) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", a.pos);
      g.setAttribute("normal", a.nrm);
      if (a.uv) g.setAttribute("uv", a.uv);
      g.setIndex(new THREE.BufferAttribute(u32(p.indices), 1));
      const map = p.texture !== null ? textures[p.texture] ?? null : null;
      const mat = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0xb8bcc8, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      owned.push(g, mat);
      root.add(new THREE.Mesh(g, mat));
    }
    // ZZZ models stand along z
    if (mesh.up === "z") root.rotation.x = -Math.PI / 2;

    const bounds = new THREE.Box3().setFromObject(root);
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const dist = (Math.max(size.y * 1.3, size.x, size.z) / (2 * Math.tan((15 * Math.PI) / 180))) * 1.1 || 3;
    const cam = new THREE.PerspectiveCamera(30, 1, dist / 200, dist * 20);
    const controls = new OrbitControls(cam, canvas);
    controls.addEventListener("change", () => render());
    render = () => renderer.render(scene, cam);

    const home = () => {
      cam.position.set(centre.x, centre.y, centre.z + dist);
      controls.target.copy(centre);
      controls.update();
    };
    const orbit = (axis: THREE.Vector3, deg: number) => {
      const off = cam.position.clone().sub(controls.target).applyAxisAngle(axis, (deg * Math.PI) / 180);
      cam.position.copy(controls.target).add(off);
      controls.update();
    };
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      render();
    };
    home();
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    view.current = {
      turn: (deg) => orbit(new THREE.Vector3(0, 1, 0), deg),
      tilt: (deg) => {
        const right = new THREE.Vector3().subVectors(cam.position, controls.target).cross(cam.up).normalize();
        orbit(right, deg);
      },
      zoom: (k) => {
        const off = cam.position.clone().sub(controls.target).multiplyScalar(k);
        if (off.length() < dist * 0.05 || off.length() > dist * 6) return;
        cam.position.copy(controls.target).add(off);
        controls.update();
      },
      reset: home,
      snap: () => {
        const ratio = renderer.getPixelRatio();
        renderer.setPixelRatio(1);
        renderer.setSize(1280, 720, false);
        cam.aspect = 16 / 9;
        cam.updateProjectionMatrix();
        render();
        // toBlob copies the picture now, so the view can go back to its own size straight after
        const blob = new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
        renderer.setPixelRatio(ratio);
        fit();
        return blob;
      },
    };
    el.focus({ preventScroll: true });

    return () => {
      view.current = null;
      ro.disconnect();
      controls.dispose();
      owned.forEach((o) => o.dispose());
      renderer.dispose();
      // the rendering log skips a context lost on purpose (lib/renderWatch.ts)
      canvas.dataset.closing = "1";
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [mesh]);

  const onKey = (e: KeyboardEvent) => {
    const v = view.current;
    if (!v) { if (e.key === "Escape") { e.stopPropagation(); onClose(); } return; }
    const step = e.shiftKey ? 45 : 15;
    const act: Record<string, () => void> = {
      ArrowLeft: () => v.turn(-step), ArrowRight: () => v.turn(step),
      ArrowUp: () => v.tilt(-step / 2), ArrowDown: () => v.tilt(step / 2),
      "+": () => v.zoom(0.85), "=": () => v.zoom(0.85), "-": () => v.zoom(1.18),
      Home: v.reset, "0": v.reset, Escape: onClose,
    };
    const f = act[e.key];
    if (!f || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    f();
  };

  const snap = async () => {
    const blob = await view.current?.snap();
    if (blob) onSnapshot(blob);
  };

  return (
    <div className="mod-viewer-wrap">
      <div ref={box} className={`mod-viewer${mesh ? "" : " is-wait"}`} tabIndex={0} title={mesh ? TIP : undefined}
        aria-label={mesh ? `3D view. ${TIP}` : "3D view"} onKeyDown={onKey}>
        {!mesh && !error && <span className="mod-viewer-msg"><span className="spin" aria-hidden="true" />Reading the model</span>}
        {error && <span className="mod-viewer-msg">{error}</span>}
        <div className="mod-drawer-picact">
          {mesh && (
            <Button size="sm" className="on-img" icon="camera" busy={saving} onClick={() => void snap()}
              title="Save this view as the mod's preview picture">Use as preview</Button>
          )}
          {mesh && <IconButton size="sm" variant="secondary" className="on-img" icon="refresh" label="Reset the view (Home)" onClick={() => view.current?.reset()} />}
          <IconButton size="sm" variant="secondary" className="on-img" icon="x" label="Close the 3D view (Esc)" onClick={onClose} />
        </div>
      </div>
      {mesh && (
        <p className="hint mod-viewer-note">
          The parts this mod replaces, as its toggles are set now ({mesh.triangles.toLocaleString()} triangles).
          {mesh.notes.length > 0 && ` ${mesh.notes.join(". ")}.`}
        </p>
      )}
    </div>
  );
}
