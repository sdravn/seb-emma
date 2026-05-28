const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ------------------------------------------------------------------
   Sample diary entries — shown until the user imports their own photos.
   These have no `img` field; they render as drop-target placeholders.
------------------------------------------------------------------ */
const SAMPLE_PHOTOS = [
{ id: "p01", caption: "first roll of the year", date: "2025-01-08", aspect: 3 / 2 },
{ id: "p02", caption: "snow morning, north window", date: "2025-01-22", aspect: 2 / 3 },
{ id: "p03", caption: "K. waiting for the kettle", date: "2025-02-03", aspect: 3 / 2 },
{ id: "p04", caption: "valentines, no one home", date: "2025-02-14", aspect: 3 / 2 },
{ id: "p05", caption: "thaw on the fire escape", date: "2025-03-01", aspect: 3 / 2 },
{ id: "p06", caption: "march light, kitchen floor", date: "2025-03-19", aspect: 2 / 3 },
{ id: "p07", caption: "cherry blossoms (overexposed)", date: "2025-04-07", aspect: 3 / 2 },
{ id: "p08", caption: "long lunch at the diner", date: "2025-04-21", aspect: 3 / 2 },
{ id: "p09", caption: "empty pool, may", date: "2025-05-04", aspect: 3 / 2 },
{ id: "p10", caption: "the new bike", date: "2025-05-18", aspect: 2 / 3 },
{ id: "p11", caption: "L. on the train", date: "2025-06-02", aspect: 3 / 2 },
{ id: "p12", caption: "6:14am, off the redeye", date: "2025-06-15", aspect: 3 / 2 },
{ id: "p13", caption: "backyard birthday", date: "2025-07-09", aspect: 3 / 2 },
{ id: "p14", caption: "swim, the long way home", date: "2025-07-27", aspect: 3 / 2 },
{ id: "p15", caption: "smoke season", date: "2025-08-11", aspect: 2 / 3 },
{ id: "p16", caption: "empty studio, august", date: "2025-08-29", aspect: 3 / 2 },
{ id: "p17", caption: "first cold front", date: "2025-09-12", aspect: 3 / 2 },
{ id: "p18", caption: "demos!", date: "2025-09-23", aspect: 3 / 2 },
{ id: "p19", caption: "long shadows on 4th st", date: "2025-10-04", aspect: 3 / 2 },
{ id: "p20", caption: "halloween, somebody's window", date: "2025-10-30", aspect: 2 / 3 },
{ id: "p21", caption: "first roast of the year", date: "2025-11-17", aspect: 3 / 2 },
{ id: "p22", caption: "december, finally quiet", date: "2025-12-21", aspect: 3 / 2 }];


const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/avif"];
const DIARY_STATE = ".diary.state.json";

/* ------------------------------------------------------------------
   utility — interpolation, clamp, date parsing
------------------------------------------------------------------ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d, ts: new Date(y, m - 1, d).getTime() };
}

/* Sort key for ordering within a month. Falls back to the day-of-month
   so the default order is the natural date order; user reorders bump
   `order` to an explicit value that overrides this. */
const monthKey = (d) => (d || "").slice(0, 7);
const photoOrder = (p) => {
  if (typeof p.order === "number") return p.order;
  const day = parseInt((p.date || "").slice(8, 10), 10);
  return Number.isFinite(day) ? day : 0;
};
/* Sort newest-first by month, then by `order` desc (so larger order
   appears first within the same month — matches "newer first"). */
function sortPhotos(arr) {
  return arr.slice().sort((a, b) => {
    const ma = monthKey(a.date),mb = monthKey(b.date);
    if (ma !== mb) return mb.localeCompare(ma);
    return photoOrder(b) - photoOrder(a);
  });
}

/* Parse a date from a filename. Looks for YYYY-MM-DD, YYYY_MM_DD,
   YYYYMMDD, or YYYY.MM.DD anywhere in the name. Falls back to the
   file's last-modified timestamp. */
function dateFromFilename(name, fallbackTs) {
  const patterns = [
  /(\d{4})[-_.](\d{2})[-_.](\d{2})/,
  /(\d{4})(\d{2})(\d{2})/];

  for (const p of patterns) {
    const m = name.match(p);
    if (m) {
      const y = +m[1],mo = +m[2],d = +m[3];
      if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${m[1]}-${m[2]}-${m[3]}`;
      }
    }
  }
  const dt = new Date(fallbackTs || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/* Caption from filename — strip extension and friendly-ify separators. */
function captionFromFilename(name) {
  return name.
  replace(/\.[^.]+$/, "").
  replace(/[_-]+/g, " ").
  replace(/\s+/g, " ").
  trim().
  toLowerCase();
}

/* Resize an image file through canvas and return a webp data URL plus
   its real dimensions. Caps the longest side at MAX_DIM (1600px). */
async function imageToDataUrl(file, MAX_DIM = 1600) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    return { url: canvas.toDataURL("image/webp", 0.85), w: bitmap.width, h: bitmap.height };
  } finally {
    bitmap.close && bitmap.close();
  }
}

/* Walk a webkit FileSystemEntry recursively, pushing all leaf files. */
async function walkEntry(entry, out) {
  if (!entry) return;
  if (entry.isFile) {
    await new Promise((res, rej) => entry.file((f) => {out.push(f);res();}, rej));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let chunk;
    do {
      chunk = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of chunk) await walkEntry(e, out);
    } while (chunk.length);
  }
}

/* Pull files out of a DataTransfer — handles single files, multi-select,
   and dropped folders (via webkitGetAsEntry). */
async function filesFromDataTransfer(dt) {
  const out = [];
  if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
    const entries = [];
    for (const it of dt.items) {
      const e = it.webkitGetAsEntry?.();
      if (e) entries.push(e);
    }
    for (const e of entries) await walkEntry(e, out);
  } else if (dt.files && dt.files.length) {
    for (const f of dt.files) out.push(f);
  }
  return out.filter((f) => ACCEPT.includes(f.type));
}

/* Persistence — read and write the diary state sidecar. */
async function loadDiaryState() {
  try {
    const r = await fetch(DIARY_STATE);
    if (!r.ok) return null;
    return await r.json();
  } catch {return null;}
}
function saveDiaryState(state) {
  const w = window.omelette && window.omelette.writeFile;
  if (!w) return Promise.resolve();
  return Promise.resolve(w(DIARY_STATE, JSON.stringify(state))).catch(() => {});
}

/* ------------------------------------------------------------------
   Photo card — renders an <img> for imported photos, or a drop-target
   image-slot for empty placeholder entries.
------------------------------------------------------------------ */
function PhotoCard({ photo, distance, isCenter, dims, positionX, aspect, onAspect, tweaks, onOpen }) {
  const ad = Math.abs(distance);
  const scaleK = tweaks?.neighborScale ?? 0.45;
  const fadeK = tweaks?.neighborFade ?? 0.32;
  const scale = ad === 0 ? 1 : 1 / (1 + ad * scaleK);
  const opacity = ad === 0 ? 1 : Math.max(0.12, 1 - ad * fadeK);
  const blur = ad > 1.2 ? `blur(${Math.min(2, (ad - 1.2) * 1.2)}px)` : "none";
  const z = 100 - Math.round(ad * 10);

  const slotRef = useRef(null);

  // If this card is showing an image-slot (no imported image), watch the
  // slot for drops and forward the measured aspect up so the strip
  // re-flows around the new frame width.
  useEffect(() => {
    if (photo.img) return; // imported photos already report aspect at import time
    const slot = slotRef.current;
    if (!slot) return;
    let imgEl = null;
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const root = slot.shadowRoot;
      if (!root) return;
      const img = root.querySelector("img");
      if (!img || !img.naturalWidth || !img.naturalHeight) return;
      const a = img.naturalWidth / img.naturalHeight;
      onAspect && onAspect(clamp(a, 0.5, 2.2));
    };

    const attach = () => {
      const root = slot.shadowRoot;
      if (!root) return;
      const img = root.querySelector("img");
      if (img && img !== imgEl) {
        if (imgEl) imgEl.removeEventListener("load", measure);
        imgEl = img;
        imgEl.addEventListener("load", measure);
      }
      measure();
    };

    const raf = requestAnimationFrame(() => {attach();measure();});
    const mo = new MutationObserver(attach);
    mo.observe(slot, { attributes: true, attributeFilter: ["data-filled"] });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      mo.disconnect();
      if (imgEl) imgEl.removeEventListener("load", measure);
    };
  }, [photo.img, onAspect]);

  // Derive frame width × height from aspect + the unified size budget.
  let h = dims.maxH;
  let w = h * aspect;
  if (w > dims.maxW) {w = dims.maxW;h = w / aspect;}

  // Tap-vs-drag detection. The carousel stage owns horizontal dragging via
  // pointer capture on an ancestor — we only want to fire onOpen when the
  // pointer came down and went up in roughly the same place.
  const downRef = useRef(null);
  const onPointerDown = (e) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e) => {
    const d = downRef.current;
    downRef.current = null;
    if (!d || !onOpen) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) < 6 && Date.now() - d.t < 600) {
      onOpen();
    }
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: w,
        height: h,
        transform: `translate(-50%, calc(-50% + ${dims.biasY || 0}px)) translateX(${positionX}px) scale(${scale})`,
        opacity,
        filter: blur,
        zIndex: z,
        transition: "width .35s ease, height .35s ease, filter .25s ease",
        willChange: "transform, opacity",
        cursor: photo.img || photo.placeholder ? "zoom-in" : undefined
      }}>
      
      <div style={{
        position: "absolute", inset: 0,
        boxShadow: isCenter ?
        "0 30px 60px -20px rgba(40,30,15,.35), 0 8px 18px -8px rgba(40,30,15,.25)" :
        "0 12px 28px -14px rgba(40,30,15,.25)",
        background: "rgba(40,30,15,.04)",
        overflow: "hidden"
      }}>
        {photo.img ?
        <img
          src={photo.img}
          alt={photo.caption}
          draggable={false}
          style={{
            display: "block", width: "100%", height: "100%",
            objectFit: "cover", userSelect: "none"
          }} /> :


        <image-slot
          ref={slotRef}
          id={`slot-${photo.id}`}
          shape="rect"
          fit="cover"
          placeholder={photo.caption}
          style={{ display: "block", width: "100%", height: "100%" }}>
        </image-slot>
        }
      </div>
    </div>);

}

/* derive layout dimensions from viewport */
function usePhotoDims() {
  const [d, setD] = useState(() => computeDims());
  useEffect(() => {
    const on = () => setD(computeDims());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return d;
}
function computeDims() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const STAGE_BOTTOM = 200;
  const stageH = Math.max(200, vh - 80 - STAGE_BOTTOM);
  const maxH = Math.min(Math.floor(stageH * 0.92), 540);
  const maxW = Math.min(Math.floor(vw * 0.48), 720);
  const biasY = Math.max(0, Math.min(70, Math.round((stageH - maxH) / 2 - 8)));
  return { maxW, maxH, biasY };
}

/* ------------------------------------------------------------------
   Timeline scrubber
------------------------------------------------------------------ */
function Scrubber({ photos, index, fIndex, onScrub, onScrubEnd }) {
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const [containerW, setContainerW] = useState(720);

  // Fixed pixel spacing between ticks. The whole row slides so the active
  // photo's tick lands at the fixed center needle.
  const SPACING = 14;

  // Measure the outer container width so the translate math centers exactly.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setContainerW(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const dateLabel = useMemo(() => {
    if (!photos.length) return { month: "", year: "" };
    const a = clamp(Math.floor(fIndex), 0, photos.length - 1);
    const b = Math.min(photos.length - 1, a + 1);
    const t = fIndex - a;
    const da = parseDate(photos[a].date);
    const db = parseDate(photos[b].date);
    const ts = lerp(da.ts, db.ts, t);
    const d = new Date(ts);
    return { month: MONTHS[d.getMonth()], year: d.getFullYear() };
  }, [fIndex, photos]);

  const caption = photos[index]?.caption ?? "";

  // Drag-from-baseline: remember fIndex on pointerdown, translate cursor
  // delta into a new fIndex on pointermove.
  const onDown = (e) => {
    if (photos.length < 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startF: fIndex, moved: false };
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 2) d.moved = true;
    onScrub(clamp(d.startF - dx / SPACING, 0, photos.length - 1));
  };
  const onUp = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // If the user clicked without dragging, jump to the tick they tapped.
    if (!d.moved && containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      const center = r.left + r.width / 2;
      const offset = e.clientX - center;
      onScrub(clamp(d.startF + offset / SPACING, 0, photos.length - 1));
    }
    dragRef.current = null;
    onScrubEnd && onScrubEnd();
  };

  // Slide the row so fIndex's tick sits at the container's center.
  const translateX = containerW / 2 - fIndex * SPACING;

  return (
    <div style={{
      position: "absolute",
      left: "50%", bottom: 80,
      transform: "translateX(-50%)",
      width: "min(720px, 86vw)",
      userSelect: "none"
    }}>
      <div style={{
        fontStyle: "italic", fontSize: 20,
        color: "var(--ink)",
        letterSpacing: ".005em", height: 26, transition: "opacity .2s",
        fontFamily: "Geist", textAlign: "center"
      }}>
        {caption}
      </div>

      <div
        ref={containerRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          position: "relative",
          marginTop: 10,
          height: 36,
          overflow: "hidden",
          cursor: photos.length > 1 ? "ew-resize" : "default",
          touchAction: "pan-y"
        }}>
        
        {/* Sliding tick row */}
        <div style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${translateX}px)`,
          willChange: "transform"
        }}>
          {photos.map((p, i) =>
          <div key={p.id} style={{
            position: "absolute",
            left: i * SPACING,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 1,
            height: 16,
            background: "var(--ink-faint)"
          }} />
          )}
        </div>

        {/* Fixed center needle — the "you are here" indicator */}
        <div style={{
          position: "absolute",
          left: "50%", top: 0, bottom: 0,
          transform: "translateX(-50%)",
          width: 1.5,
          background: "var(--ink)",
          pointerEvents: "none"
        }} />
      </div>

      <div style={{
        marginTop: 10, textAlign: "center",
        color: "var(--ink-soft)", fontFamily: "var(--mono)",
        fontSize: 11, letterSpacing: ".12em", lineHeight: 1.5,
        textTransform: "uppercase"
      }}>
        <div>{dateLabel.month}</div>
        <div style={{ opacity: .7 }}>{dateLabel.year}</div>
      </div>
    </div>);

}

/* ------------------------------------------------------------------
   Add-photo button + modal form.
   One photo at a time: pick file, type a caption, choose a date.
------------------------------------------------------------------ */
function AddButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Add a photo"
      title="Add a photo"
      style={{
        position: "absolute", top: 28, right: 72, zIndex: 50,
        width: 28, height: 28, borderRadius: "50%",
        background: "transparent",
        border: "1px solid var(--ink-soft)",
        color: "var(--ink-soft)",
        cursor: "pointer",
        display: "grid", placeItems: "center",
        padding: 0,
        transition: "background .15s, color .15s"
      }}
      onMouseEnter={(e) => {e.currentTarget.style.background = "var(--ink)";e.currentTarget.style.color = "var(--paper)";}}
      onMouseLeave={(e) => {e.currentTarget.style.background = "transparent";e.currentTarget.style.color = "var(--ink-soft)";}}>
      
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>);

}

function AddPhotoModal({ initialFile, queueRemaining, onSave, onCancel, onSkip }) {
  const fileInput = useRef(null);
  const captionInput = useRef(null);
  const [file, setFile] = useState(initialFile || null);
  const [caption, setCaption] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  // Pre-fill caption + date whenever the file changes.
  useEffect(() => {
    if (!file) {setPreview(null);return;}
    setCaption(captionFromFilename(file.name));
    setDate(dateFromFilename(file.name, file.lastModified));
    const url = URL.createObjectURL(file);
    setPreview(url);
    // Move focus to the caption field for quick typing.
    setTimeout(() => captionInput.current?.select(), 30);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // initialFile changes when the queue advances to the next file.
  useEffect(() => {setFile(initialFile || null);}, [initialFile]);

  // Escape to cancel.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const doSave = async () => {
    if (!file || !date) return;
    setSaving(true);
    try {
      await onSave({ file, caption: caption.trim() || captionFromFilename(file.name), date });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onCancel}
      data-modal
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(244,241,234,.78)",
        backdropFilter: "blur(6px)",
        display: "grid", placeItems: "center"
      }}>
      
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 92vw)",
          background: "var(--paper)",
          border: "1px solid rgba(40,30,15,.14)",
          boxShadow: "0 40px 80px -24px rgba(40,30,15,.30)",
          padding: "28px 28px 22px",
          fontFamily: "var(--sans)", color: "var(--ink)"
        }}>
        
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 26, lineHeight: 1 }}>
            Add a photo
          </div>
          {queueRemaining > 0 &&
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-soft)", letterSpacing: ".14em", textTransform: "uppercase" }}>
              {queueRemaining} more queued
            </div>
          }
        </div>

        {/* photo well — preview or picker */}
        <button
          onClick={() => fileInput.current?.click()}
          style={{
            display: "block", width: "100%", aspectRatio: "3 / 2",
            padding: 0,
            background: preview ? "#1a1815" : "rgba(40,30,15,.04)",
            border: "1px dashed rgba(40,30,15,.22)",
            cursor: "pointer",
            position: "relative", overflow: "hidden",
            marginBottom: 16
          }}>
          
          {preview ?
          <img src={preview} alt="" draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} /> :

          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 6, color: "var(--ink-soft)"
          }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <div style={{ fontSize: 13 }}>Click to choose a photo</div>
              <div style={{ fontSize: 11, opacity: .7 }}>or drop one anywhere</div>
            </div>
          }
        </button>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f && ACCEPT.includes(f.type)) setFile(f);
            e.target.value = "";
          }} />
        

        {/* caption */}
        <Field label="Caption">
          <input
            ref={captionInput}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="a few words about this photo"
            style={inputStyle} />
          
        </Field>

        {/* date */}
        <Field label="Date">
          <MonthPicker
            value={date}
            onChange={(v) => setDate(v)} />
          
        </Field>

        {/* actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          {queueRemaining > 0 &&
          <button onClick={onSkip} style={btnGhostStyle} disabled={saving}>
              Skip
            </button>
          }
          <button onClick={onCancel} style={btnGhostStyle} disabled={saving}>
            Cancel
          </button>
          <button
            onClick={doSave}
            disabled={!file || !date || saving}
            style={{
              ...btnPrimaryStyle,
              opacity: !file || !date || saving ? 0.5 : 1,
              cursor: !file || !date || saving ? "default" : "pointer"
            }}>
            
            {saving ? "Saving…" : "Add to diary"}
          </button>
        </div>
      </div>
    </div>);

}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-soft)",
        letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6
      }}>{label}</div>
      {children}
    </label>);

}

/* ------------------------------------------------------------------
   MonthPicker — custom month + year grid (no native date input).
   Value is stored as "YYYY-MM-01".
------------------------------------------------------------------ */
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MonthPicker({ value, onChange }) {
  const today = useMemo(() => new Date(), []);
  // Parse the current value. Falls back to today.
  const parsed = useMemo(() => {
    if (!value) return { y: today.getFullYear(), m: today.getMonth() };
    const [yy, mm] = value.split("-").map(Number);
    return { y: yy || today.getFullYear(), m: mm ? mm - 1 : today.getMonth() };
  }, [value, today]);

  // The year currently being shown in the grid.
  const [viewYear, setViewYear] = useState(parsed.y);
  // Keep viewYear in sync if the selected value's year changes externally.
  useEffect(() => {setViewYear(parsed.y);}, [parsed.y]);

  const select = (monthIdx) => {
    onChange(`${viewYear}-${String(monthIdx + 1).padStart(2, "0")}-01`);
  };

  return (
    <div
    // Stop clicks bubbling so the <label> wrapper doesn't fire a synthetic
    // click on the underlying input (there isn't one) and so the modal's
    // outside-click handler stays silent.
    onClick={(e) => e.stopPropagation()}
    style={{
      background: "rgba(40,30,15,.04)",
      border: "1px solid rgba(40,30,15,.12)",
      padding: "10px 12px 12px"
    }}>
      
      {/* Year row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8
      }}>
        <YearArrow dir={-1} onClick={() => setViewYear((y) => y - 1)} />
        <div style={{
          fontFamily: "var(--mono)", fontSize: 13,
          letterSpacing: ".14em", color: "var(--ink)"
        }}>{viewYear}</div>
        <YearArrow dir={1} onClick={() => setViewYear((y) => y + 1)} />
      </div>

      {/* Month grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {SHORT_MONTHS.map((label, i) => {
          const isSelected = viewYear === parsed.y && i === parsed.m;
          const isToday = viewYear === today.getFullYear() && i === today.getMonth();
          return (
            <button
              key={i}
              type="button"
              onClick={() => select(i)}
              style={{
                padding: "9px 4px",
                fontFamily: "var(--sans)", fontSize: 12,
                color: isSelected ? "var(--paper)" : "var(--ink)",
                background: isSelected ? "var(--ink)" : "transparent",
                border: "1px solid " + (isSelected ? "var(--ink)" : "rgba(40,30,15,.10)"),
                cursor: "pointer",
                position: "relative",
                transition: "background .12s, color .12s, border-color .12s"
              }}
              onMouseEnter={(e) => {if (!isSelected) e.currentTarget.style.background = "rgba(40,30,15,.06)";}}
              onMouseLeave={(e) => {if (!isSelected) e.currentTarget.style.background = "transparent";}}>
              
              {label}
              {isToday && !isSelected &&
              <span style={{
                position: "absolute", left: "50%", bottom: 3,
                transform: "translateX(-50%)",
                width: 3, height: 3, borderRadius: "50%",
                background: "var(--ink-soft)"
              }} />
              }
            </button>);

        })}
      </div>
    </div>);

}

function YearArrow({ dir, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir < 0 ? "previous year" : "next year"}
      style={{
        width: 26, height: 26, borderRadius: "50%",
        background: "transparent",
        border: "1px solid rgba(40,30,15,.14)",
        color: "var(--ink)",
        cursor: "pointer",
        display: "grid", placeItems: "center",
        padding: 0, fontFamily: "var(--sans)", fontSize: 14, lineHeight: 1
      }}
      onMouseEnter={(e) => {e.currentTarget.style.background = "rgba(40,30,15,.06)";}}
      onMouseLeave={(e) => {e.currentTarget.style.background = "transparent";}}>
      
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
        {dir < 0 ?
        <path d="M6 1 L2 4.5 L6 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /> :

        <path d="M3 1 L7 4.5 L3 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        }
      </svg>
    </button>);

}

const inputStyle = {
  display: "block", width: "100%",
  background: "rgba(40,30,15,.04)",
  border: "1px solid rgba(40,30,15,.12)",
  padding: "9px 12px",
  fontFamily: "var(--sans)", fontSize: 14,
  color: "var(--ink)",
  outline: "none"
};
const btnGhostStyle = {
  background: "transparent",
  border: "1px solid var(--ink-soft)",
  color: "var(--ink-soft)",
  padding: "9px 14px",
  fontFamily: "var(--mono)", fontSize: 11,
  letterSpacing: ".12em", textTransform: "uppercase",
  cursor: "pointer"
};
const btnPrimaryStyle = {
  background: "var(--ink)",
  border: "1px solid var(--ink)",
  color: "var(--paper)",
  padding: "9px 16px",
  fontFamily: "var(--mono)", fontSize: 11,
  letterSpacing: ".12em", textTransform: "uppercase",
  cursor: "pointer"
};

function DropOverlay({ active, count }) {
  if (!active) return null;
  return (
    <div style={{
      position: "fixed", inset: 16, zIndex: 210,
      background: "rgba(244,241,234,.92)",
      backdropFilter: "blur(4px)",
      border: "1.5px dashed var(--ink)",
      display: "grid", placeItems: "center",
      pointerEvents: "none"
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontFamily: "var(--serif)", fontStyle: "italic",
          fontSize: 42, color: "var(--ink)", marginBottom: 8
        }}>
          Drop to import
        </div>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 11,
          letterSpacing: ".18em", textTransform: "uppercase",
          color: "var(--ink-soft)"
        }}>
          {count > 0 ? `${count} image${count === 1 ? "" : "s"}` : "folders & images accepted"}
        </div>
      </div>
    </div>);

}

/* ------------------------------------------------------------------
   App
------------------------------------------------------------------ */
function App() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS || {
    gap: 20, photoSize: 1.0, neighborScale: 0.45, neighborFade: 0.32
  });
  const [fIndex, setFIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const dims = usePhotoDims();
  const effDims = useMemo(() => ({
    ...dims,
    maxW: Math.round(dims.maxW * t.photoSize),
    maxH: Math.round(dims.maxH * t.photoSize)
  }), [dims, t.photoSize]);

  // Dynamic photo list. Hydrated from .diary.state.json once on mount.
  const [photos, setPhotos] = useState(SAMPLE_PHOTOS);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    loadDiaryState().then((s) => {
      if (s && Array.isArray(s.photos) && s.photos.length) {
        // Always show newest first.
        setPhotos(sortPhotos(s.photos));
      }
      setHydrated(true);
    });
  }, []);

  // updateAspect — image-slot reports a measured aspect; we patch the
  // photo record AND persist (if the user is using their own diary).
  const updateAspect = useCallback((i, a) => {
    setPhotos((prev) => {
      if (!prev[i] || Math.abs((prev[i].aspect || 0) - a) < 0.005) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], aspect: a };
      // Only persist if at least one imported photo exists — otherwise the
      // user is still on samples and we don't want to write a state file.
      if (hydrated && next.some((p) => p.img)) saveDiaryState({ photos: next });
      return next;
    });
  }, [hydrated]);

  // Frame widths from per-photo aspects.
  const widths = useMemo(() => photos.map((p) => {
    const a = p.aspect || 3 / 2;
    let h = effDims.maxH;
    let w = h * a;
    if (w > effDims.maxW) {w = effDims.maxW;h = w / a;}
    return w;
  }), [photos, effDims.maxW, effDims.maxH]);

  const gap = Math.max(0, Math.round(t.gap || 0));
  const centers = useMemo(() => {
    const c = [0];
    for (let i = 1; i < widths.length; i++) {
      c.push(c[i - 1] + widths[i - 1] / 2 + gap + widths[i] / 2);
    }
    return c;
  }, [widths, gap]);

  const avgStep = useMemo(() => {
    if (!widths.length) return 1;
    const avg = widths.reduce((s, w) => s + w, 0) / widths.length;
    return avg + gap;
  }, [widths, gap]);

  const targetRef = useRef(0);
  const rafRef = useRef(null);
  const snapTimer = useRef(null);

  const snapToNearest = useCallback(() => {
    targetRef.current = clamp(Math.round(targetRef.current), 0, photos.length - 1);
  }, [photos.length]);
  const scheduleSnap = useCallback((delay = 120) => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {snapTimer.current = null;snapToNearest();}, delay);
  }, [snapToNearest]);
  const cancelSnap = useCallback(() => {
    if (snapTimer.current) {clearTimeout(snapTimer.current);snapTimer.current = null;}
  }, []);

  useEffect(() => {
    const tick = () => {
      setFIndex((prev) => {
        const tgt = targetRef.current;
        const diff = tgt - prev;
        if (Math.abs(diff) < 0.001) return tgt;
        return prev + diff * 0.18;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    setIndex(clamp(Math.round(fIndex), 0, Math.max(0, photos.length - 1)));
  }, [fIndex, photos.length]);

  const setTarget = useCallback((v) => {
    targetRef.current = clamp(v, 0, Math.max(0, photos.length - 1));
  }, [photos.length]);

  const step = useCallback((dir) => {
    setTarget(Math.round(targetRef.current) + dir);
  }, [setTarget]);

  useEffect(() => {
    const onWheel = (e) => {
      // Don't hijack the wheel when the user is interacting with a modal,
      // popover, form field, or anything else outside the stage.
      if (e.target && e.target.closest && e.target.closest("input, textarea, select, [data-modal]")) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setTarget(targetRef.current + delta * 0.0035);
      scheduleSnap(140);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [setTarget, scheduleSnap]);

  useEffect(() => {
    const onKey = (e) => {
      // Skip when the user is typing in a field or navigating a date popover.
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.target && e.target.isContentEditable) return;
      if (e.target && e.target.closest && e.target.closest("[data-modal]")) return;
      if (e.key === "ArrowRight") step(1);else
      if (e.key === "ArrowLeft") step(-1);else
      if (e.key === "Home") setTarget(0);else
      if (e.key === "End") setTarget(photos.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, setTarget, photos.length]);

  const stageRef = useRef(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let dragStartX = 0,dragStartT = 0,dragging = false;
    const onDown = (e) => {
      if (e.target.closest("image-slot")) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartT = targetRef.current;
      el.setPointerCapture?.(e.pointerId);
      el.style.cursor = "grabbing";
      cancelSnap();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      setTarget(dragStartT - dx / Math.max(120, avgStep));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = "grab";
      scheduleSnap(0);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [setTarget, avgStep, scheduleSnap, cancelSnap]);

  /* ─── Add-photo flow ─────────────────────────────────────────── */
  // The modal handles ONE photo at a time. When the user drops multiple
  // files, the rest sit in `queue` and feed into the modal one by one.
  const [modalFile, setModalFile] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [queue, setQueue] = useState([]);

  const openModal = useCallback((file = null) => {
    setModalFile(file);
    setModalOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalFile(null);
    setQueue([]);
  }, []);

  // Advance to the next queued file, or close the modal if the queue is empty.
  const nextOrClose = useCallback(() => {
    setQueue((rest) => {
      if (rest.length === 0) {
        setModalOpen(false);
        setModalFile(null);
        return rest;
      }
      const [next, ...remaining] = rest;
      setModalFile(next);
      return remaining;
    });
  }, []);

  // Add a single photo with the metadata the user supplied.
  const addPhoto = useCallback(async ({ file, caption, date }) => {
    const { url, w, h } = await imageToDataUrl(file);
    const aspect = clamp(w / h, 0.5, 2.2);
    const photo = {
      id: `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      caption,
      date,
      img: url,
      aspect
    };
    setPhotos((prev) => {
      const isSampleOnly = prev.every((p) => !p.img);
      const merged = sortPhotos(isSampleOnly ? [photo] : [...prev, photo]);
      saveDiaryState({ photos: merged });
      // Jump to the freshly-added photo so the user sees it land.
      const idx = merged.findIndex((p) => p.id === photo.id);
      if (idx >= 0) targetRef.current = idx;
      return merged;
    });
    nextOrClose();
  }, [nextOrClose]);

  // window-level drag & drop — the FIRST file opens the modal pre-filled,
  // any additional files go into the queue.
  const [dragActive, setDragActive] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  useEffect(() => {
    let depth = 0;
    const onDragEnter = (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      depth++;
      setDragActive(true);
      setDragCount(e.dataTransfer.items?.length || e.dataTransfer.files?.length || 0);
    };
    const onDragOver = (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = () => {
      depth--;
      if (depth <= 0) {depth = 0;setDragActive(false);}
    };
    const onDrop = async (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = await filesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      const [first, ...rest] = files;
      setQueue(rest);
      openModal(first);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [openModal]);

  const clearDiary = useCallback(() => {
    if (!confirm("Clear all imported photos? This restores the placeholder samples.")) return;
    setPhotos(SAMPLE_PHOTOS);
    targetRef.current = 0;
    saveDiaryState({ photos: [] });
  }, []);

  // Persist a single photo edit (caption / date). Re-sorts by date so the
  // carousel order matches the chronology.
  const updatePhoto = useCallback((id, patch) => {
    setPhotos((prev) => {
      const next = sortPhotos(prev.map((p) => p.id === id ? { ...p, ...patch } : p));
      if (hydrated && next.some((p) => p.img)) saveDiaryState({ photos: next });
      return next;
    });
  }, [hydrated]);

  const removePhoto = useCallback((id) => {
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) {
        saveDiaryState({ photos: [] });
        return SAMPLE_PHOTOS;
      }
      if (hydrated && next.some((p) => p.img)) saveDiaryState({ photos: next });
      return next;
    });
  }, [hydrated]);

  // Manually reorder a photo within its month. dir = -1 moves it earlier
  // in the carousel (toward index 0), dir = +1 moves it later. Only works
  // when an adjacent photo shares the same year-month.
  const movePhoto = useCallback((id, dir) => {
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      if (monthKey(prev[i].date) !== monthKey(prev[j].date)) return prev;
      // Swap explicit `order` values so the sort persists the new order.
      const oi = photoOrder(prev[i]);
      const oj = photoOrder(prev[j]);
      // If the swap wouldn't change anything (equal orders), nudge.
      const newOi = oi === oj ? oj - 1 : oj;
      const newOj = oi === oj ? oi + 1 : oi;
      const next = prev.map((p, k) => {
        if (k === i) return { ...p, order: newOi };
        if (k === j) return { ...p, order: newOj };
        return p;
      });
      const sorted = sortPhotos(next);
      if (hydrated && sorted.some((p) => p.img)) saveDiaryState({ photos: sorted });
      return sorted;
    });
  }, [hydrated]);

  const [infoOpen, setInfoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [lightboxId, setLightboxId] = useState(null);
  const hasImports = photos.some((p) => p.img);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{
        position: "absolute", top: 2, left: 32, zIndex: 50,
        display: "flex", alignItems: "center"
      }}>
        <Monogram />
      </div>

      <AddButton onClick={() => openModal()} />

      <button
        onClick={() => setInfoOpen((v) => !v)}
        aria-label="about"
        style={{
          position: "absolute", top: 28, right: 32, zIndex: 50,
          width: 28, height: 28, borderRadius: "50%",
          background: "transparent",
          border: "1px solid var(--ink-soft)",
          color: "var(--ink-soft)",
          fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14,
          cursor: "pointer",
          display: "grid", placeItems: "center"
        }}>
        i</button>

      <div
        ref={stageRef}
        data-screen-label="Carousel"
        style={{
          position: "absolute",
          left: 0, right: 0,
          top: 80, bottom: 200,
          cursor: "grab",
          touchAction: "none"
        }}>
        
        {photos.map((p, i) => {
          const a = clamp(Math.floor(fIndex), 0, Math.max(0, centers.length - 1));
          const b = clamp(a + 1, 0, Math.max(0, centers.length - 1));
          const tt = fIndex - a;
          const focusX = centers[a] + (centers[b] - centers[a]) * tt;
          return (
            <PhotoCard
              key={p.id}
              photo={p}
              distance={i - fIndex}
              isCenter={i === index}
              dims={effDims}
              aspect={p.aspect || 3 / 2}
              onAspect={(av) => updateAspect(i, av)}
              positionX={centers[i] - focusX}
              tweaks={t}
              onOpen={() => {
                if (i === index) {
                  setLightboxId(p.id);
                } else {
                  setTarget(i);
                }
              }} />);


        })}
      </div>

      <Scrubber
        photos={photos}
        index={index}
        fIndex={fIndex}
        onScrub={(v) => {cancelSnap();setTarget(v);}}
        onScrubEnd={() => scheduleSnap(0)} />
      

      <div style={{
        position: "absolute", right: 32, bottom: 32,
        fontFamily: "var(--mono)", fontSize: 11,
        color: "var(--ink-soft)", letterSpacing: ".12em"
      }}>
        {String(index + 1).padStart(2, "0")} / {String(photos.length).padStart(2, "0")}
      </div>

      <div style={{
        position: "absolute", left: 32, bottom: 32,
        fontFamily: "var(--mono)", fontSize: 11,
        color: "var(--ink-faint)", letterSpacing: ".12em"
      }}>
        scroll · drag · ← →
      </div>

      <DropOverlay active={dragActive} count={dragCount} />
      {modalOpen &&
      <AddPhotoModal
        initialFile={modalFile}
        queueRemaining={queue.length}
        onSave={addPhoto}
        onCancel={closeModal}
        onSkip={nextOrClose} />

      }
      {infoOpen && <InfoOverlay onClose={() => setInfoOpen(false)} onEdit={() => { setInfoOpen(false); setEditOpen(true); }} />}
      {editOpen && <EditOverlay photos={photos} onClose={() => setEditOpen(false)} onUpdate={updatePhoto} onRemove={removePhoto} onMove={movePhoto} />}
      {lightboxId && <Lightbox photos={photos} startId={lightboxId} onClose={() => setLightboxId(null)} />}

      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakSlider
          label="Gap between photos"
          value={t.gap} min={0} max={120} step={2} unit="px"
          onChange={(v) => setTweak("gap", v)} />
        
        <TweakSlider
          label="Photo size"
          value={t.photoSize} min={0.6} max={1.2} step={0.05}
          onChange={(v) => setTweak("photoSize", v)} />
        
        <TweakSection label="Neighbors" />
        <TweakSlider
          label="Shrink falloff"
          value={t.neighborScale} min={0.1} max={0.9} step={0.05}
          onChange={(v) => setTweak("neighborScale", v)} />
        
        <TweakSlider
          label="Fade falloff"
          value={t.neighborFade} min={0.05} max={0.7} step={0.05}
          onChange={(v) => setTweak("neighborFade", v)} />
        
      </TweaksPanel>
    </div>);

}

function Monogram() {
  return (
    <img
      src="logo.png"
      alt="Seb & Emma"
      draggable={false}
      style={{
        display: "block",
        userSelect: "none", height: "80px", width: "80px"
      }} />);


}

function InfoOverlay({ onClose, onEdit }) {
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 200,
      background: "rgba(244,241,234,.85)",
      backdropFilter: "blur(6px)",
      display: "grid", placeItems: "center",
      cursor: "pointer"
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: 480, padding: "40px 44px",
        background: "var(--paper)",
        border: "1px solid rgba(40,30,15,.12)",
        cursor: "default",
        boxShadow: "0 30px 60px -20px rgba(40,30,15,.25)"
      }}>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 30, marginBottom: 14 }}>{"Seb & Emma <3"}

        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)", marginBottom: 14 }}>A little film reel of us — Friends, family and all the things
in between. All the moments worth keeping, strung together in the order they happened.

        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)", marginBottom: 22 }}>To browse, just scroll, drag, or hit the arrow keys


        </p>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={{
            background: "transparent",
            border: "1px solid var(--ink-soft)",
            color: "var(--ink-soft)",
            padding: "8px 14px",
            fontFamily: "var(--mono)", fontSize: 11,
            letterSpacing: ".12em", textTransform: "uppercase",
            cursor: "pointer", marginBottom: 18
          }}>
          Edit entries
        </button>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)",
          letterSpacing: ".18em", textTransform: "uppercase"
        }}>
          Click anywhere to dismiss
        </div>
      </div>
    </div>);

}

function EditOverlay({ photos, onClose, onUpdate, onRemove, onMove }) {
  // Local working copy so typing feels immediate; commits on blur.
  const [draft, setDraft] = useState(() => {
    const m = {};
    photos.forEach((p) => { m[p.id] = { caption: p.caption || "", date: p.date || "" }; });
    return m;
  });

  useEffect(() => {
    // Keep draft in sync when photos list changes (e.g. after delete / reorder).
    setDraft((prev) => {
      const next = { ...prev };
      photos.forEach((p) => {
        if (!next[p.id]) next[p.id] = { caption: p.caption || "", date: p.date || "" };
      });
      return next;
    });
  }, [photos]);

  const commit = (id, key, value) => {
    const cur = photos.find((p) => p.id === id);
    if (!cur) return;
    if ((cur[key] || "") === value) return;
    onUpdate(id, { [key]: value });
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      data-modal
      onClick={onClose}
      onKeyDown={onKeyDown}
      style={{
        position: "absolute", inset: 0, zIndex: 250,
        background: "rgba(244,241,234,.92)",
        backdropFilter: "blur(8px)",
        display: "grid", placeItems: "center",
        cursor: "pointer"
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)",
          maxHeight: "82vh",
          background: "var(--paper)",
          border: "1px solid rgba(40,30,15,.12)",
          boxShadow: "0 30px 60px -20px rgba(40,30,15,.25)",
          cursor: "default",
          display: "flex", flexDirection: "column"
        }}>
        <div style={{
          padding: "28px 36px 18px",
          borderBottom: "1px solid rgba(40,30,15,.08)",
          display: "flex", alignItems: "baseline", justifyContent: "space-between"
        }}>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 26 }}>
            Edit entries
          </div>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)",
            letterSpacing: ".18em", textTransform: "uppercase"
          }}>
            {photos.length} {photos.length === 1 ? "photo" : "photos"}
          </div>
        </div>

        <div style={{
          overflowY: "auto",
          padding: "8px 12px 12px",
          flex: 1
        }}>
          {photos.map((p, i) => {
            const d = draft[p.id] || { caption: p.caption || "", date: p.date || "" };
            const canUp = i > 0 && monthKey(photos[i - 1].date) === monthKey(p.date);
            const canDown = i < photos.length - 1 && monthKey(photos[i + 1].date) === monthKey(p.date);
            return (
              <div key={p.id} style={{
                display: "grid",
                gridTemplateColumns: "64px 1fr 130px 22px 28px",
                gap: 14, alignItems: "center",
                padding: "10px 24px",
                borderBottom: "1px solid rgba(40,30,15,.06)"
              }}>
                <div style={{
                  width: 64, height: 48,
                  background: p.img ? "transparent" : "rgba(40,30,15,.06)",
                  backgroundImage: p.img ? `url(${p.img})` : "none",
                  backgroundSize: "cover", backgroundPosition: "center",
                  border: "1px solid rgba(40,30,15,.12)"
                }} />
                <input
                  type="text"
                  value={d.caption}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [p.id]: { ...prev[p.id], caption: e.target.value } }))}
                  onBlur={(e) => commit(p.id, "caption", e.target.value.trim())}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  placeholder="caption"
                  style={editInputStyle} />
                <input
                  type="date"
                  value={d.date}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [p.id]: { ...prev[p.id], date: e.target.value } }))}
                  onBlur={(e) => { if (e.target.value) commit(p.id, "date", e.target.value); }}
                  style={editInputStyle} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button
                    onClick={() => onMove(p.id, -1)}
                    disabled={!canUp}
                    aria-label="move earlier in carousel"
                    title="Move earlier (within month)"
                    style={arrowBtnStyle(canUp)}>
                    ▲
                  </button>
                  <button
                    onClick={() => onMove(p.id, 1)}
                    disabled={!canDown}
                    aria-label="move later in carousel"
                    title="Move later (within month)"
                    style={arrowBtnStyle(canDown)}>
                    ▼
                  </button>
                </div>
                <button
                  onClick={() => {
                    if (confirm("Remove this photo?")) onRemove(p.id);
                  }}
                  aria-label="remove"
                  title="Remove"
                  style={{
                    width: 24, height: 24,
                    background: "transparent",
                    border: "1px solid rgba(40,30,15,.18)",
                    color: "var(--ink-soft)",
                    fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1,
                    cursor: "pointer",
                    display: "grid", placeItems: "center"
                  }}>
                  ×
                </button>
              </div>);
          })}
        </div>

        <div style={{
          padding: "14px 36px",
          borderTop: "1px solid rgba(40,30,15,.08)",
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)",
            letterSpacing: ".18em", textTransform: "uppercase"
          }}>
            Changes save automatically
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--ink)",
              border: "1px solid var(--ink)",
              color: "var(--paper)",
              padding: "8px 18px",
              fontFamily: "var(--mono)", fontSize: 11,
              letterSpacing: ".12em", textTransform: "uppercase",
              cursor: "pointer"
            }}>
            Done
          </button>
        </div>
      </div>
    </div>);
}

const editInputStyle = {
  width: "100%",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(40,30,15,.18)",
  padding: "6px 2px",
  fontFamily: "var(--serif)", fontSize: 14,
  color: "var(--ink)",
  outline: "none"
};

const arrowBtnStyle = (enabled) => ({
  width: 22, height: 18,
  background: "transparent",
  border: "1px solid rgba(40,30,15,.18)",
  color: enabled ? "var(--ink-soft)" : "rgba(40,30,15,.18)",
  fontSize: 8, lineHeight: 1,
  cursor: enabled ? "pointer" : "default",
  display: "grid", placeItems: "center",
  padding: 0
});

/* ------------------------------------------------------------------
   Lightbox — full-screen view of a single photo. No chrome — just
   the image on a dark backdrop. Click anywhere or press Esc to close.
------------------------------------------------------------------ */
function Lightbox({ photos, startId, onClose }) {
  const p = photos.find((x) => x.id === startId);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!p) onClose();
  }, [p, onClose]);

  if (!p) return null;

  return (
    <div
      data-modal
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, zIndex: 300,
        background: "rgba(20,16,10,.92)",
        backdropFilter: "blur(10px)",
        display: "grid", placeItems: "center",
        cursor: "zoom-out",
        padding: 24
      }}>
      {p.img &&
      <img
        src={p.img}
        alt=""
        draggable={false}
        style={{
          maxWidth: "100%", maxHeight: "100%",
          objectFit: "contain",
          userSelect: "none",
          pointerEvents: "none"
        }} />
      }
    </div>);
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);